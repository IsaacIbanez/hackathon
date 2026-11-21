package llm

import (
	"bufio"
	"os"
	"strings"
)

// CargarDotEnv lee líneas CLAVE=valor de un archivo (normalmente .env, que está en
// .gitignore) y las pone en el entorno si no estaban ya. Si el archivo no existe, no hace nada.
// Ignora líneas vacías y comentarios (#); quita comillas simples o dobles del valor.
func CargarDotEnv(ruta string) {
	f, err := os.Open(ruta)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		linea := strings.TrimSpace(sc.Text())
		if linea == "" || strings.HasPrefix(linea, "#") {
			continue
		}
		linea = strings.TrimPrefix(linea, "export ")
		clave, valor, ok := strings.Cut(linea, "=")
		if !ok {
			continue
		}
		clave, valor = strings.TrimSpace(clave), strings.TrimSpace(valor)
		if len(valor) >= 2 && (valor[0] == '"' || valor[0] == '\'') && valor[len(valor)-1] == valor[0] {
			valor = valor[1 : len(valor)-1]
		}
		if _, existe := os.LookupEnv(clave); !existe {
			_ = os.Setenv(clave, valor)
		}
	}
}
