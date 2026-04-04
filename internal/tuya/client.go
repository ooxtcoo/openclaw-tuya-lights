package tuya

import (
	"bytes"
	"crypto/aes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"net"
	"strconv"
	"time"
)

const (
	prefix55AA = 0x000055AA
	suffix55AA = 0x0000AA55

	cmdControl = 7
	cmdStatus  = 10
)

var noProtocolHeaderCommands = map[uint32]bool{
	cmdStatus: true,
}

// Client is a minimal Tuya LAN v3.3 client.
type Client struct {
	DeviceID string
	Address  string
	LocalKey string
	Version  string
	Timeout  time.Duration
	Sequence uint32
}

// NewClient creates a minimal Tuya client.
func NewClient(deviceID, address, localKey string, version float64) *Client {
	return &Client{
		DeviceID: deviceID,
		Address:  address,
		LocalKey: localKey,
		Version:  strconv.FormatFloat(version, 'f', 1, 64),
		Timeout:  5 * time.Second,
		Sequence: 1,
	}
}

// Status requests the current DPS state from the device.
func (c *Client) Status() (map[string]interface{}, error) {
	payloadObj := map[string]interface{}{
		"gwId":  c.DeviceID,
		"devId": c.DeviceID,
		"uid":   c.DeviceID,
		"t":     strconv.FormatInt(time.Now().Unix(), 10),
	}
	resp, err := c.roundTrip(cmdStatus, payloadObj)
	if err != nil {
		return nil, err
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, fmt.Errorf("decode status JSON: %w", err)
	}
	if dps, ok := parsed["dps"].(map[string]interface{}); ok {
		return dps, nil
	}
	if data, ok := parsed["data"].(map[string]interface{}); ok {
		if dps, ok := data["dps"].(map[string]interface{}); ok {
			return dps, nil
		}
	}
	return parsed, nil
}

// SetValue sets a single DPS value.
func (c *Client) SetValue(dp int, value interface{}) (map[string]interface{}, error) {
	return c.SetValues(map[int]interface{}{dp: value})
}

// SetValues sets multiple DPS values in one request.
func (c *Client) SetValues(values map[int]interface{}) (map[string]interface{}, error) {
	dps := make(map[string]interface{}, len(values))
	for dp, value := range values {
		dps[strconv.Itoa(dp)] = value
	}
	payloadObj := map[string]interface{}{
		"devId": c.DeviceID,
		"uid":   c.DeviceID,
		"t":     strconv.FormatInt(time.Now().Unix(), 10),
		"dps":   dps,
	}
	resp, err := c.roundTrip(cmdControl, payloadObj)
	if err != nil {
		return nil, err
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(resp, &parsed); err != nil {
		return nil, fmt.Errorf("decode control JSON: %w", err)
	}
	return parsed, nil
}

func (c *Client) roundTrip(cmd uint32, payloadObj map[string]interface{}) ([]byte, error) {
	if len(c.LocalKey) != 16 {
		return nil, fmt.Errorf("local key must be 16 bytes, got %d", len(c.LocalKey))
	}
	plain, err := json.Marshal(payloadObj)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	plain = bytes.ReplaceAll(plain, []byte(" "), nil)
	encrypted, err := encryptECB([]byte(c.LocalKey), plain)
	if err != nil {
		return nil, err
	}
	messagePayload := encrypted
	if !noProtocolHeaderCommands[cmd] {
		messagePayload = append([]byte(c.Version+"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"), encrypted...)
	}
	packet, err := pack55AA(c.Sequence, cmd, messagePayload)
	if err != nil {
		return nil, err
	}
	c.Sequence++

	conn, err := net.DialTimeout("tcp", net.JoinHostPort(c.Address, "6668"), c.Timeout)
	if err != nil {
		return nil, fmt.Errorf("connect to %s: %w", c.Address, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(c.Timeout))
	if _, err := conn.Write(packet); err != nil {
		return nil, fmt.Errorf("write packet: %w", err)
	}
	response, err := readPacket(conn)
	if err != nil {
		return nil, err
	}
	decoded, err := unpackAndDecrypt55AA([]byte(c.LocalKey), []byte(c.Version), response)
	if err != nil {
		return nil, err
	}
	return decoded, nil
}

func pack55AA(seq uint32, cmd uint32, payload []byte) ([]byte, error) {
	buf := &bytes.Buffer{}
	if err := binary.Write(buf, binary.BigEndian, uint32(prefix55AA)); err != nil {
		return nil, err
	}
	if err := binary.Write(buf, binary.BigEndian, seq); err != nil {
		return nil, err
	}
	if err := binary.Write(buf, binary.BigEndian, cmd); err != nil {
		return nil, err
	}
	length := uint32(len(payload) + 8)
	if err := binary.Write(buf, binary.BigEndian, length); err != nil {
		return nil, err
	}
	if _, err := buf.Write(payload); err != nil {
		return nil, err
	}
	crc := crc32.ChecksumIEEE(buf.Bytes())
	if err := binary.Write(buf, binary.BigEndian, crc); err != nil {
		return nil, err
	}
	if err := binary.Write(buf, binary.BigEndian, uint32(suffix55AA)); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func readPacket(r io.Reader) ([]byte, error) {
	head := make([]byte, 16)
	if _, err := io.ReadFull(r, head); err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	length := binary.BigEndian.Uint32(head[12:16])
	if length < 8 || length > 4096 {
		return nil, fmt.Errorf("unexpected packet length %d", length)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return append(head, body...), nil
}

func unpackAndDecrypt55AA(key []byte, version []byte, packet []byte) ([]byte, error) {
	if len(packet) < 24 {
		return nil, fmt.Errorf("packet too short")
	}
	prefix := binary.BigEndian.Uint32(packet[0:4])
	if prefix != prefix55AA {
		return nil, fmt.Errorf("unexpected prefix 0x%08x", prefix)
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
	if len(payload) >= 4 && payload[0] == 0x00 && payload[1] == 0x00 && payload[2] == 0x00 && payload[3] == 0x00 {
		candidate := payload[4:]
		if len(candidate) > 0 {
			payload = candidate
		}
	}
	if bytes.HasPrefix(payload, version) {
		if len(payload) < 15 {
			return nil, fmt.Errorf("versioned payload too short")
		}
		payload = payload[15:]
	}
	plain, err := decryptECB(key, payload)
	if err != nil {
		return nil, err
	}
	return bytes.TrimSpace(plain), nil
}

func encryptECB(key []byte, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	padded := pkcs7Pad(plaintext, block.BlockSize())
	out := make([]byte, len(padded))
	for bs := 0; bs < len(padded); bs += block.BlockSize() {
		block.Encrypt(out[bs:bs+block.BlockSize()], padded[bs:bs+block.BlockSize()])
	}
	return out, nil
}

func decryptECB(key []byte, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	if len(ciphertext) == 0 || len(ciphertext)%block.BlockSize() != 0 {
		return nil, fmt.Errorf("ciphertext length %d is not a multiple of block size", len(ciphertext))
	}
	out := make([]byte, len(ciphertext))
	for bs := 0; bs < len(ciphertext); bs += block.BlockSize() {
		block.Decrypt(out[bs:bs+block.BlockSize()], ciphertext[bs:bs+block.BlockSize()])
	}
	return pkcs7Unpad(out, block.BlockSize())
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	padLen := blockSize - (len(data) % blockSize)
	if padLen == 0 {
		padLen = blockSize
	}
	padding := bytes.Repeat([]byte{byte(padLen)}, padLen)
	return append(data, padding...)
}

func pkcs7Unpad(data []byte, blockSize int) ([]byte, error) {
	if len(data) == 0 || len(data)%blockSize != 0 {
		return nil, fmt.Errorf("invalid padded data length")
	}
	padLen := int(data[len(data)-1])
	if padLen == 0 || padLen > blockSize || padLen > len(data) {
		return nil, fmt.Errorf("invalid padding length")
	}
	for _, b := range data[len(data)-padLen:] {
		if int(b) != padLen {
			return nil, fmt.Errorf("invalid padding bytes")
		}
	}
	return data[:len(data)-padLen], nil
}
