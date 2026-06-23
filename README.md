# FoomScript
“this probably should not work but does.”

A programming language for when “let the model figure it out” needs a call stack.


## Examples

### Basics - Hello World
```
VIBEFUNCTION main()
	res = Hello, world!
	VIBERETURN(res)
```

### Basics - Function call
```
VIBEFUNCTION main()
	res = VIBECALL mul(a = 3, my number = 9)
	VIBERETURN(res)

VIBEFUNCTION mul(a: number, my number: number)
	n = a * my number
	VIBERETURN(n)
```

### Basics - Recursion
```
VIBEFUNCTION main()
	res = VIBECALL fac(n = 4)
	VIBERETURN(res)

VIBEFUNCTION fac(n: number)
	if n <= 1
        VIBERETURN(1)
    else
        subres = VIBECALL fac(n = n - 1)
        n = n * subres
	VIBERETURN(n)
```
