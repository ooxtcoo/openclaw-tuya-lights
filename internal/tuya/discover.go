package tuya

import (
	"bytes"
	"crypto/md5"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

const (
	udpPort31  = 6666
	udpPort33  = 6667
	udpPortApp = 7000
)

// DiscoverResult represents one discovered Tuya broadcast device.
type DiscoverResult struct {
	IP         string                 `json:"ip,omitempty"`
	Version    interface{}            `json:"version,omitempty"`
	GWID       string                 `json:"gwId,omitempty"`
	ProductKey string                 `json:"productKey,omitempty"`
	OriginPort int                    `json:"origin_port,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
}

// Discover listens for Tuya UDP broadcasts for the given duration.
func Discover(timeout time.Duration) ([]DiscoverResult, error) {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ports := []int{udpPort31, udpPort33, udpPortApp}
	conns := make([]*net.UDPConn, 0, len(ports))
	for _, port := range ports {
		addr := &net.UDPAddr{IP: net.IPv4zero, Port: port}
		conn, err := net.ListenUDP("udp4", addr)
		if err != nil {
			for _, c := range conns {
				_ = c.Close()
			}
			return nil, fmt.Errorf("listen on UDP %d: %w", port, err)
		}
		conns = append(conns, conn)
	}
	defer func() {
		for _, conn := range conns {
			_ = conn.Close()
		}
	}()

	deadline := time.Now().Add(timeout)
	seen := map[string]DiscoverResult{}
	buf := make([]byte, 4096)

	for time.Now().Before(deadline) {
		for _, conn := range conns {
			_ = conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
			n, addr, err := conn.ReadFromUDP(buf)
			if err != nil {
				continue
			}
			decoded, err := decryptUDP(buf[:n])
			if err != nil {
				continue
			}
			var payload map[string]interface{}
			if err := json.Unmarshal(decoded, &payload); err != nil {
				continue
			}
			gwid, _ := payload["gwId"].(string)
			key := gwid
			if key == "" {
				key = addr.IP.String() + ":" + payloadString(payload, "productKey")
			}
			seen[key] = DiscoverResult{
				IP:         addr.IP.String(),
				Version:    payload["version"],
				GWID:       gwid,
				ProductKey: payloadString(payload, "productKey"),
				OriginPort: conn.LocalAddr().(*net.UDPAddr).Port,
				Data:       payload,
			}
		}
	}

	results := make([]DiscoverResult, 0, len(seen))
	for _, result := range seen {
		results = append(results, result)
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].IP == results[j].IP {
			return results[i].GWID < results[j].GWID
		}
		return results[i].IP < results[j].IP
	})
	return results, nil
}

func decryptUDP(packet []byte) ([]byte, error) {
	udpKey := md5.Sum([]byte("yGAdlopoPVldABfn"))

	if len(packet) >= 4 {
		prefix := binary.BigEndian.Uint32(packet[:4])
		if prefix == prefix55AA {
			payload, err := extract55AAPayload(packet)
			if err != nil {
				return nil, err
			}
			if len(payload) > 0 && payload[0] == '{' && payload[len(payload)-1] == '}' {
				return payload, nil
			}
			return decryptECB(udpKey[:], payload)
		}
	}

	return decryptECB(udpKey[:], packet)
}

func extract55AAPayload(packet []byte) ([]byte, error) {
	if len(packet) < 24 {
		return nil, fmt.Errorf("packet too short")
	}
	length := binary.BigEndian.Uint32(packet[12:16])
	total := 16 + int(length)
	if len(packet) < total {
		return nil, fmt.Errorf("incomplete packet")
	}
	payloadWithTrailer := packet[16:total]
	if len(payloadWithTrailer) < 8 {
		return nil, fmt.Errorf("payload too short")
	}
	payload := payloadWithTrailer[:len(payloadWithTrailer)-8]
	if len(payload) >= 4 && bytes.Equal(payload[:4], []byte{0, 0, 0, 0}) {
		payload = payload[4:]
	}
	return bytes.TrimSpace(payload), nil
}

func payloadString(payload map[string]interface{}, key string) string {
	v, _ := payload[key].(string)
	return strings.TrimSpace(v)
}
