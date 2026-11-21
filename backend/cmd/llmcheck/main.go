// Quick check of the model client with the real key:
//
//	go run ./backend/cmd/llmcheck "What is an insurance deductible?"
//	go run ./backend/cmd/llmcheck -expensive -image photo.jpg "What does this document say?"
//
// Needs OPENROUTER_API_KEY in the environment or in .env. Paid models cost real money
// (cents or less); use LLM_PROFILE=dev to try free models first.
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
	expensive := flag.Bool("expensive", false, "use the expensive model")
	image := flag.String("image", "", "path of an image to send with the question")
	maxTokens := flag.Int("max", 1500, "max answer tokens (reasoning models spend part of them thinking)")
	flag.Parse()
	question := strings.Join(flag.Args(), " ")
	if question == "" {
		question = "Answer only: hello"
	}

	c, err := llm.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	msg := llm.Message{Role: "user", Text: question}
	if *image != "" {
		data, err := os.ReadFile(*image)
		if err != nil {
			log.Fatal(err)
		}
		mimeType := mime.TypeByExtension(filepath.Ext(*image))
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		msg.Images = []string{"data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)}
	}
	req := llm.Request{Tier: llm.Cheap, Messages: []llm.Message{msg}, MaxTokens: *maxTokens}
	if *expensive {
		req.Tier = llm.Expensive
	}

	r, err := c.Complete(context.Background(), req)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(r.Text)
	fmt.Printf("\nmodel %s · %d+%d tokens · %.6f USD · %d ms\n", r.Model, r.PromptTokens, r.CompletionTokens, r.CostUSD, r.Latency.Milliseconds())
	st, _ := json.MarshalIndent(c.Meter.Snapshot(), "", "  ")
	fmt.Println(string(st))
}
