// Prueba rápida del cliente de modelos con la clave real:
//
//	go run ./backend/cmd/llmprueba "¿Qué es una franquicia en un seguro?"
//	go run ./backend/cmd/llmprueba -caro -imagen foto.jpg "¿Qué pone en este documento?"
//
// Necesita OPENROUTER_API_KEY en el entorno. Cada llamada cuesta dinero real (céntimos o menos).
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/IsaacIbanez/hackathon/backend/llm"
)

func main() {
	caro := flag.Bool("caro", false, "usar el modelo caro")
	imagen := flag.String("imagen", "", "ruta de una imagen para enviar con la pregunta")
	maxTokens := flag.Int("max", 1500, "máximo de tokens de respuesta (los modelos que razonan gastan parte en pensar)")
	flag.Parse()
	pregunta := strings.Join(flag.Args(), " ")
	if pregunta == "" {
		pregunta = "Responde solo: hola"
	}

	c, err := llm.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	msg := llm.Message{Role: "user", Text: pregunta}
	if *imagen != "" {
		datos, err := os.ReadFile(*imagen)
		if err != nil {
			log.Fatal(err)
		}
		tipo := mime.TypeByExtension(filepath.Ext(*imagen))
		if tipo == "" {
			tipo = "image/jpeg"
		}
		msg.Images = []string{"data:" + tipo + ";base64," + base64.StdEncoding.EncodeToString(datos)}
	}
	req := llm.Request{Tier: llm.Barato, Messages: []llm.Message{msg}, MaxTokens: *maxTokens}
	if *caro {
		req.Tier = llm.Caro
	}

	r, err := c.Complete(context.Background(), req)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(r.Text)
	fmt.Printf("\nmodelo %s · %d+%d tokens · %.6f USD · %d ms\n", r.Model, r.PromptTokens, r.CompletionTokens, r.CostUSD, r.Latency.Milliseconds())
	st, _ := json.MarshalIndent(c.Meter.Snapshot(), "", "  ")
	fmt.Println(string(st))
}
