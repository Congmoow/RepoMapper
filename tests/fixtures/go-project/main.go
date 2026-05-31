package main

import (
	"fmt"

	"github.com/test/proj/pkg/auth"
	"github.com/test/proj/pkg/utils"
)

func main() {
	fmt.Println(auth.User(), utils.Name())
}
