package main

import (
	"fmt"
	"os"

	"github.com/atlas/lampctl/internal/lampctl"
)

// main is the CLI entry point.
func main() {
	if err := lampctl.Run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
