package session

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/llm"
)

// ---------- Prompts ----------

const systemPrompt = `You help a person with low vision understand and fill in a paper document.
You receive the document as OCR text blocks, each with an id and an OCR confidence.
Rules:
- Answer in the document's language (or the user's, if they asked a question), in plain words, short sentences, no jargon.
- At most 4 sentences: the answer is read aloud.
- Never invent content that is not in the blocks; if the OCR looks unreliable, say what is unclear.
- Reply ONLY with a JSON object: {"speech": "<text to read aloud>", "highlight": ["<block id>", ...]}
  where "highlight" lists the ids of the blocks your answer refers to (may be empty).`

func blocksText(doc *gen.DocumentPayload) string {
	var b strings.Builder
	for _, bl := range doc.Blocks {
		fmt.Fprintf(&b, "[%s] (confidence %.2f) %s\n", bl.Id, bl.Confidence, bl.Text)
	}
	return b.String()
}

func explainPrompt(doc *gen.DocumentPayload) string {
	lang := deref(doc.Lang)
	if lang == "" {
		lang = "unknown (detect it)"
	}
	return fmt.Sprintf("Document language: %s\nBlocks:\n%s\nExplain what this document is and what the person has to do or fill in.",
		lang, blocksText(doc))
}

func questionPrompt(doc *gen.DocumentPayload, pointedBlock, question string) string {
	var pointed string
	if pointedBlock != "" {
		pointed = fmt.Sprintf("The person is pointing at block [%s].\n", pointedBlock)
	}
	return fmt.Sprintf("Blocks:\n%s\n%sThe person asks: %q\nAnswer the question.", blocksText(doc), pointed, question)
}

// ---------- Answers ----------

type answer struct {
	Speech    string   `json:"speech"`
	Highlight []string `json:"highlight"`
}

// parseAnswer extracts the JSON answer, tolerating code fences or text around it.
// It drops highlight ids that are not in the document and reports how many it dropped.
// ok is false when there is no usable JSON with a non-empty speech.
func parseAnswer(text string, doc *gen.DocumentPayload) (a answer, dropped int, ok bool) {
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return answer{}, 0, false
	}
	if err := json.Unmarshal([]byte(text[start:end+1]), &a); err != nil {
		return answer{}, 0, false
	}
	a.Speech = strings.TrimSpace(a.Speech)
	if a.Speech == "" {
		return answer{}, 0, false
	}
	known := map[string]bool{}
	for _, b := range doc.Blocks {
		known[b.Id] = true
	}
	valid := a.Highlight[:0]
	for _, id := range a.Highlight {
		if known[id] {
			valid = append(valid, id)
		}
	}
	dropped = len(a.Highlight) - len(valid)
	a.Highlight = valid
	return a, dropped, true
}

// DefaultDoubt is the placeholder escalation criterion until role B2 provides theirs:
// escalate when the cheap answer is not usable JSON, has no speech, or highlights blocks
// that do not exist (a sign the model did not follow the document).
func DefaultDoubt(doc *gen.DocumentPayload, r llm.Response) bool {
	_, dropped, ok := parseAnswer(r.Text, doc)
	return !ok || dropped > 0
}

// ---------- Local answers (no model call) ----------

// framingHint returns advice when the document cannot be explained yet.
func framingHint(doc *gen.DocumentPayload, minQuality float32, lang string) (string, bool) {
	if len(doc.Blocks) == 0 {
		return localText(lang, "noText"), true
	}
	if doc.Quality.Score >= minQuality {
		return "", false
	}
	for _, issue := range doc.Quality.Issues {
		if t := localText(lang, string(issue)); t != "" {
			return t, true
		}
	}
	return localText(lang, "lowQuality"), true
}

// Spoken texts for the local answers. They are user-facing content, so they exist in
// the user's languages; the code around them is in English.
var localTexts = map[string]map[string]string{
	"es": {
		"noDocument": "Todavía no veo ningún documento. Ponlo delante de la cámara.",
		"noText":     "No consigo leer texto. Pon el documento delante de la cámara, bien iluminado.",
		"lowQuality": "No veo bien el documento. Sujétalo quieto y bien iluminado.",
		"blurry":     "La imagen está borrosa. Sujeta el papel quieto un momento.",
		"dark":       "Está muy oscuro. Busca más luz.",
		"glare":      "Hay reflejos. Inclina un poco el papel.",
		"cropped":    "Falta parte del documento. Aléjalo un poco para que se vea entero.",
		"tilted":     "El documento está torcido. Ponlo recto delante de la cámara.",
		"too_far":    "El documento está lejos. Acércalo a la cámara.",
		"modelError": "Ahora mismo no puedo explicarlo. Vuelve a intentarlo en unos segundos.",
	},
	"en": {
		"noDocument": "I can't see any document yet. Hold it in front of the camera.",
		"noText":     "I can't read any text. Hold the document in front of the camera, with good light.",
		"lowQuality": "I can't see the document well. Hold it still, with good light.",
		"blurry":     "The image is blurry. Hold the paper still for a moment.",
		"dark":       "It's too dark. Find more light.",
		"glare":      "There is glare. Tilt the paper a little.",
		"cropped":    "Part of the document is missing. Move it back a little so it fits.",
		"tilted":     "The document is tilted. Hold it straight in front of the camera.",
		"too_far":    "The document is too far. Bring it closer to the camera.",
		"modelError": "I can't explain it right now. Try again in a few seconds.",
	},
}

func localText(lang, key string) string {
	base := strings.ToLower(strings.SplitN(lang, "-", 2)[0])
	texts, ok := localTexts[base]
	if !ok {
		texts = localTexts["es"]
	}
	return texts[key]
}

// speechLang turns a language code into a BCP-47 voice tag (es -> es-ES). Default: es-ES.
func speechLang(lang string) string {
	switch strings.ToLower(lang) {
	case "", "es":
		return "es-ES"
	case "en":
		return "en-US"
	case "ca":
		return "ca-ES"
	case "fr":
		return "fr-FR"
	case "de":
		return "de-DE"
	}
	return lang
}
