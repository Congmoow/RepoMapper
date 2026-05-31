package auth

import (
	_ "github.com/test/proj/pkg/utils"
	tools "github.com/test/proj/pkg/utils"
)

func User() string {
	return tools.Name()
}
