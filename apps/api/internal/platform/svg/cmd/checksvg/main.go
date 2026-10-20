// checksvg validates build assets with exactly the same package as uploads.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/svg"
)

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "Укажите пути SVG для проверки.")
		return 2
	}
	failed := false
	for _, name := range args {
		f, err := os.Open(name)
		if err != nil {
			fmt.Fprintf(stderr, "%s: не удалось открыть SVG\n", name)
			failed = true
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, svg.MaxBytes+1))
		_ = f.Close()
		if err != nil {
			fmt.Fprintf(stderr, "%s: не удалось прочитать SVG\n", name)
			failed = true
			continue
		}
		normalized, err := svg.Normalize(string(data))
		if err != nil {
			fmt.Fprintf(stderr, "%s: %s\n", name, err)
			failed = true
			continue
		}
		fmt.Fprintf(stdout, "OK %s: профиль %s, %d -> %d байт\n", name, svg.ProfileVersion, len(data), len(normalized))
	}
	if failed {
		return 1
	}
	return 0
}
func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
