package mock

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/IsaacIbanez/hackathon/api"
	"github.com/IsaacIbanez/hackathon/api/gen"
)

func TestHealth(t *testing.T) {
	h, err := NewMux()
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("health: %d %s", rec.Code, rec.Body)
	}
}

func TestDocumentYUtteranceRespondenConSpeakYStats(t *testing.T) {
	h, err := NewMux()
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()

	for _, c := range []struct{ fixture, replyTo string }{
		{"document.json", "doc-0001"},
		{"pointer.json", ""}, // no responde
		{"utterance.json", "utt-0001"},
	} {
		datos, _ := api.Fixtures.ReadFile("fixtures/" + c.fixture)
		if err := conn.Write(ctx, websocket.MessageText, datos); err != nil {
			t.Fatal(err)
		}
		if c.replyTo == "" {
			continue
		}
		var resp gen.SpeakMessage
		if err := wsjson.Read(ctx, conn, &resp); err != nil {
			t.Fatal(err)
		}
		if resp.Type != "speak" || resp.Payload.ReplyTo == nil || *resp.Payload.ReplyTo != c.replyTo || resp.Payload.Text == "" {
			t.Fatalf("%s: respuesta inesperada %+v", c.fixture, resp)
		}
		var st gen.StatsMessage
		if err := wsjson.Read(ctx, conn, &st); err != nil {
			t.Fatal(err)
		}
		if st.Type != "stats" || st.Payload.TotalCostUsd <= 0 {
			t.Fatalf("%s: tras speak esperaba stats, llegó %+v", c.fixture, st)
		}
	}
	conn.Close(websocket.StatusNormalClosure, "")
}

// Un document de página entera supera los 32 KB por defecto de la librería.
func TestDocumentGrandeNoCierraLaConexion(t *testing.T) {
	h, err := NewMux()
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()

	doc := gen.DocumentMessage{Type: "document", Id: "grande", Ts: 1, Payload: gen.DocumentPayload{Quality: gen.FrameQuality{Issues: []gen.FrameIssue{}}}}
	for i := range 600 {
		doc.Payload.Blocks = append(doc.Payload.Blocks, gen.TextBlock{
			Id: fmt.Sprintf("b%d", i), Text: strings.Repeat("texto de ejemplo ", 6), Confidence: 0.9,
		})
	}
	datos, _ := json.Marshal(doc)
	if len(datos) <= 32768 {
		t.Fatalf("el mensaje de prueba debería superar 32 KB, mide %d", len(datos))
	}
	if err := conn.Write(ctx, websocket.MessageText, datos); err != nil {
		t.Fatal(err)
	}
	var resp gen.SpeakMessage
	if err := wsjson.Read(ctx, conn, &resp); err != nil {
		t.Fatalf("sin respuesta a un document de %d bytes: %v", len(datos), err)
	}
}
