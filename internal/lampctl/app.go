package lampctl

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/atlas/lampctl/internal/tuya"
)

const (
	ActionDiscover   = "discover"
	ActionOn         = "on"
	ActionOff        = "off"
	ActionStatus     = "status"
	ActionRaw        = "raw"
	ActionBrightness = "brightness"
	ActionTemp       = "temp"
	ActionColor      = "color"
	ActionHue        = "hue"
	ActionWhite      = "white"
	ActionWarmWhite  = "warmwhite"
	ActionColdWhite  = "coldwhite"
)

var validActions = map[string]struct{}{
	ActionDiscover:   {},
	ActionOn:         {},
	ActionOff:        {},
	ActionStatus:     {},
	ActionRaw:        {},
	ActionBrightness: {},
	ActionTemp:       {},
	ActionColor:      {},
	ActionHue:        {},
	ActionWhite:      {},
	ActionWarmWhite:  {},
	ActionColdWhite:  {},
}

var aliases = map[string]string{
	"kueche":               "kitchen",
	"küche":                "kitchen",
	"kuechenlampe":         "kitchen",
	"küchenlampe":          "kitchen",
	"kitchen":              "kitchen",
	"stehlampe":            "livingroom_floor",
	"wohnzimmer":           "livingroom_floor",
	"wohnzimmer-stehlampe": "livingroom_floor",
	"stehlampe-wohnzimmer": "livingroom_floor",
	"livingroom_floor":     "livingroom_floor",
	"vorzimmer":            "vorzimmer",
	"vorzimmer1":           "vorzimmer1",
	"vorzimmer2":           "vorzimmer2",
	"vorzimmer3":           "vorzimmer3",
	"vorzimmer4":           "vorzimmer4",
	"all":                  "all",
	"alle":                 "all",
}

var colorMap = map[string]*rgbColor{
	"rot":       {R: 255, G: 0, B: 0},
	"red":       {R: 255, G: 0, B: 0},
	"gruen":     {R: 0, G: 255, B: 0},
	"grün":      {R: 0, G: 255, B: 0},
	"green":     {R: 0, G: 255, B: 0},
	"blau":      {R: 0, G: 0, B: 255},
	"blue":      {R: 0, G: 0, B: 255},
	"gelb":      {R: 255, G: 255, B: 0},
	"yellow":    {R: 255, G: 255, B: 0},
	"lila":      {R: 180, G: 0, B: 255},
	"purple":    {R: 180, G: 0, B: 255},
	"pink":      {R: 255, G: 0, B: 140},
	"orange":    {R: 255, G: 128, B: 0},
	"weiss":     {R: 255, G: 255, B: 255},
	"weiß":      {R: 255, G: 255, B: 255},
	"white":     {R: 255, G: 255, B: 255},
	"warmweiss": nil,
	"warmweiß":  nil,
	"kaltweiss": nil,
	"kaltweiß":  nil,
}

type rgbColor struct {
	R int
	G int
	B int
}

type Registry struct {
	Lamps  map[string]Lamp     `json:"lamps"`
	Groups map[string][]string `json:"groups"`
}

type Lamp struct {
	Name     string                 `json:"name"`
	DeviceID string                 `json:"device_id"`
	IP       string                 `json:"ip"`
	LocalKey string                 `json:"local_key"`
	Version  float64                `json:"version"`
	Type     string                 `json:"type"`
	Notes    string                 `json:"notes"`
	DPS      map[string]interface{} `json:"dps"`
}

type Request struct {
	Lamp   string      `json:"lamp"`
	Action string      `json:"action"`
	Value  interface{} `json:"value"`
	DP     interface{} `json:"dp"`
}

type SingleResponse struct {
	Lamp   string      `json:"lamp,omitempty"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

func Run(args []string, stdout, stderr io.Writer) error {
	if stdout == nil {
		return errors.New("stdout writer is required")
	}
	if stderr == nil {
		return errors.New("stderr writer is required")
	}

	req, err := ParseArgs(args)
	if err != nil {
		if errors.Is(err, errHelp) {
			_, _ = fmt.Fprint(stdout, Usage())
			return nil
		}
		if errors.Is(err, errUsage) {
			_, _ = fmt.Fprint(stderr, Usage())
		}
		return err
	}

	if req.Action == ActionDiscover {
		results, err := tuya.Discover(5 * time.Second)
		if err != nil {
			return err
		}
		return writeJSON(stdout, results)
	}

	reg, err := LoadRegistry()
	if err != nil {
		return err
	}

	resolvedTarget := ResolveName(req.Lamp)
	if members, ok := reg.Groups[resolvedTarget]; ok {
		if req.Action != ActionOn && req.Action != ActionOff && req.Action != ActionStatus {
			return errors.New("für Gruppen sind derzeit nur on/off/status erlaubt")
		}
		responses := make([]SingleResponse, 0, len(members))
		for _, lampName := range members {
			lamp, ok := reg.Lamps[lampName]
			if !ok {
				responses = append(responses, SingleResponse{Lamp: lampName, Error: "lamp not found in registry"})
				continue
			}
			responses = append(responses, executeAction(lampName, lamp, req))
		}
		return writeJSON(stdout, responses)
	}

	lamp, ok := reg.Lamps[resolvedTarget]
	if !ok {
		return fmt.Errorf("unbekanntes Ziel: %s\nLampen: %s\nGruppen: %s", req.Lamp, strings.Join(sortedLampKeys(reg.Lamps), ", "), strings.Join(sortedGroupKeys(reg.Groups), ", "))
	}

	return writeJSON(stdout, executeAction(resolvedTarget, lamp, req))
}

func executeAction(key string, lamp Lamp, req Request) SingleResponse {
	resp := SingleResponse{Lamp: key}
	client := tuya.NewClient(lamp.DeviceID, lamp.IP, lamp.LocalKey, lamp.Version)

	powerDP := dpInt(lamp.DPS, "power", dpInt(lamp.DPS, "switch_led", 20))
	modeDP := dpInt(lamp.DPS, "mode", dpInt(lamp.DPS, "work_mode", 21))
	brightnessDP := dpInt(lamp.DPS, "brightness", dpInt(lamp.DPS, "bright_value", 22))
	tempDP := dpInt(lamp.DPS, "temp", dpInt(lamp.DPS, "temp_value", 23))
	colorDP := dpInt(lamp.DPS, "color_data", dpInt(lamp.DPS, "colour_data", 24))

	switch req.Action {
	case ActionStatus:
		result, err := client.Status()
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = map[string]interface{}{"dps": result}
		return resp
	case ActionOn:
		result, err := client.SetValue(powerDP, true)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionOff:
		result, err := client.SetValue(powerDP, false)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionRaw:
		if req.DP == nil || req.Value == nil {
			resp.Error = "raw braucht --dp und --value"
			return resp
		}
		dp, ok := req.DP.(int)
		if !ok {
			resp.Error = "invalid dp type"
			return resp
		}
		value := parseValue(req.Value)
		result, err := client.SetValue(dp, value)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionBrightness:
		pct, err := requiredPercent(req.Value)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		raw := maxInt(10, int((float64(pct)/100.0)*1000.0))
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", brightnessDP: raw})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionTemp:
		pct, err := requiredPercent(req.Value)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		raw := int(((100.0 - float64(pct)) / 100.0) * 1000.0)
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", tempDP: raw})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionWhite:
		pct := 100
		if req.Value != nil {
			var err error
			pct, err = requiredPercent(req.Value)
			if err != nil {
				resp.Error = err.Error()
				return resp
			}
		}
		brightnessRaw := maxInt(10, int((float64(pct)/100.0)*1000.0))
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", brightnessDP: brightnessRaw, tempDP: 500})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionWarmWhite:
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", tempDP: 0})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionColdWhite:
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", tempDP: 1000})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionColor:
		if req.Value == nil {
			resp.Error = "--value is required"
			return resp
		}
		name := strings.ToLower(strings.TrimSpace(fmt.Sprint(req.Value)))
		mapped, ok := colorMap[name]
		if !ok {
			resp.Error = fmt.Sprintf("Unbekannte Farbe: %v", req.Value)
			return resp
		}
		if mapped == nil {
			if name == "warmweiss" || name == "warmweiß" {
				result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", brightnessDP: 1000, tempDP: 0})
				if err != nil {
					resp.Error = err.Error()
					return resp
				}
				resp.Result = result
				return resp
			}
			result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "white", brightnessDP: 1000, tempDP: 1000})
			if err != nil {
				resp.Error = err.Error()
				return resp
			}
			resp.Result = result
			return resp
		}
		h, s, v := rgbToHSVHex(mapped.R, mapped.G, mapped.B)
		payload := formatHSVPayload(h, s, v)
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "colour", colorDP: payload})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	case ActionHue:
		if req.Value == nil {
			resp.Error = "--value is required"
			return resp
		}
		hue, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(req.Value)))
		if err != nil {
			resp.Error = fmt.Sprintf("invalid hue value %q", req.Value)
			return resp
		}
		if hue < 0 {
			hue = 0
		}
		if hue > 360 {
			hue = 360
		}
		payload := formatHSVPayload(hue, 1000, 1000)
		result, err := client.SetValues(map[int]interface{}{powerDP: true, modeDP: "colour", colorDP: payload})
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = result
		return resp
	default:
		resp.Error = fmt.Sprintf("action %q ist noch nicht implementiert", req.Action)
		return resp
	}
}

var errUsage = errors.New("invalid arguments")
var errHelp = errors.New("help requested")

func ParseArgs(args []string) (Request, error) {
	if len(args) == 0 {
		return Request{}, fmt.Errorf("%w: missing arguments", errUsage)
	}
	if isHelp(args[0]) {
		return Request{}, errHelp
	}
	if len(args) == 1 && strings.EqualFold(strings.TrimSpace(args[0]), ActionDiscover) {
		return Request{Action: ActionDiscover}, nil
	}
	if len(args) < 2 {
		return Request{}, fmt.Errorf("%w: expected <lamp> <action>", errUsage)
	}

	req := Request{Lamp: strings.TrimSpace(args[0]), Action: strings.ToLower(strings.TrimSpace(args[1]))}
	if req.Lamp == "" {
		return Request{}, fmt.Errorf("%w: lamp name must not be empty", errUsage)
	}
	if _, ok := validActions[req.Action]; !ok {
		return Request{}, fmt.Errorf("%w: unsupported action %q", errUsage, req.Action)
	}

	remaining := args[2:]
	for i := 0; i < len(remaining); i++ {
		switch remaining[i] {
		case "--value":
			if i+1 >= len(remaining) {
				return Request{}, fmt.Errorf("%w: --value requires a value", errUsage)
			}
			req.Value = remaining[i+1]
			i++
		case "--dp":
			if i+1 >= len(remaining) {
				return Request{}, fmt.Errorf("%w: --dp requires a value", errUsage)
			}
			dpValue, err := strconv.Atoi(remaining[i+1])
			if err != nil {
				return Request{}, fmt.Errorf("%w: invalid --dp value %q", errUsage, remaining[i+1])
			}
			req.DP = dpValue
			i++
		case "--help", "-h":
			return Request{}, errHelp
		default:
			return Request{}, fmt.Errorf("%w: unknown argument %q", errUsage, remaining[i])
		}
	}
	return req, nil
}

func LoadRegistry() (Registry, error) {
	candidates := []string{"tuya_lamps.json", filepath.Join("..", "tuya-lights", "tuya_lamps.json")}
	for _, candidate := range candidates {
		data, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		var reg Registry
		if err := json.Unmarshal(data, &reg); err != nil {
			return Registry{}, fmt.Errorf("parse registry %s: %w", candidate, err)
		}
		if reg.Lamps == nil {
			reg.Lamps = map[string]Lamp{}
		}
		if reg.Groups == nil {
			reg.Groups = map[string][]string{}
		}
		return reg, nil
	}
	return Registry{}, errors.New("tuya_lamps.json not found")
}

func ResolveName(name string) string {
	key := strings.ToLower(strings.TrimSpace(name))
	if resolved, ok := aliases[key]; ok {
		return resolved
	}
	return key
}

func Usage() string {
	return strings.TrimLeft(`lampctl - Simple local Tuya lamp control

Usage:
  lampctl <lamp> <action> [--value <value>] [--dp <dp>]
  lampctl discover

Positional arguments:
  lamp        lamp/group name from registry
  action      one of: on, off, status, raw, brightness, temp, color, hue, white, warmwhite, coldwhite

Options:
  --dp <n>    datapoint number for raw mode
  --value <v> action value, depending on mode
  -h, --help  show this help message

Examples:
  lampctl stehlampe on
  lampctl stehlampe brightness --value 50
  lampctl stehlampe temp --value 75
  lampctl stehlampe color --value rot
  lampctl stehlampe hue --value 180
  lampctl kitchen raw --dp 20 --value true
  lampctl discover

Notes:
  Copyright (c) by ooxtcoo aka Harald Kubovy.
  Current build supports discover, status, on, off, raw, brightness,
  temp, color, hue, white, warmwhite and coldwhite.
`, "\n")
}

func isHelp(arg string) bool { return arg == "--help" || arg == "-h" }

func writeJSON(w io.Writer, v interface{}) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func sortedLampKeys(lamps map[string]Lamp) []string {
	keys := make([]string, 0, len(lamps))
	for key := range lamps {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedGroupKeys(groups map[string][]string) []string {
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func dpInt(dps map[string]interface{}, key string, fallback int) int {
	if dps == nil {
		return fallback
	}
	if raw, ok := dps[key]; ok {
		switch v := raw.(type) {
		case float64:
			return int(v)
		case int:
			return v
		}
	}
	return fallback
}

func parseValue(v interface{}) interface{} {
	s, ok := v.(string)
	if !ok {
		return v
	}
	low := strings.ToLower(strings.TrimSpace(s))
	if low == "true" {
		return true
	}
	if low == "false" {
		return false
	}
	if i, err := strconv.Atoi(s); err == nil {
		return i
	}
	return s
}

func requiredPercent(v interface{}) (int, error) {
	if v == nil {
		return 0, errors.New("--value is required")
	}
	s, ok := v.(string)
	if !ok {
		return 0, errors.New("--value must be a string")
	}
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, fmt.Errorf("invalid percent value %q", s)
	}
	if n < 0 {
		n = 0
	}
	if n > 100 {
		n = 100
	}
	return n, nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func rgbToHSVHex(r, g, b int) (int, int, int) {
	rf := float64(r) / 255.0
	gf := float64(g) / 255.0
	bf := float64(b) / 255.0

	maxVal := math.Max(rf, math.Max(gf, bf))
	minVal := math.Min(rf, math.Min(gf, bf))
	delta := maxVal - minVal

	h := 0.0
	s := 0.0
	v := maxVal

	if delta != 0 {
		s = delta / maxVal
		switch maxVal {
		case rf:
			h = math.Mod((gf-bf)/delta, 6.0)
		case gf:
			h = ((bf-rf)/delta + 2.0)
		case bf:
			h = ((rf-gf)/delta + 4.0)
		}
		h *= 60.0
		if h < 0 {
			h += 360.0
		}
	}

	return int(math.Round(h)), int(math.Round(s * 1000.0)), int(math.Round(v * 1000.0))
}

func formatHSVPayload(h, s, v int) string {
	if h < 0 {
		h = 0
	}
	if h > 360 {
		h = 360
	}
	if s < 0 {
		s = 0
	}
	if s > 1000 {
		s = 1000
	}
	if v < 0 {
		v = 0
	}
	if v > 1000 {
		v = 1000
	}
	return fmt.Sprintf("%04x%04x%04x", h, s, v)
}
