# perp-v1-personal

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.13. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Conepts
- Isolated margin , whatever money i  intially put as collateral that money si used .
- Cross margin whatever money i initially put in collateral will use as well as your wallet balance will use as well
- in order to close our position we need to make qty of long and short = 0 , else you will need to stuck in loop of p&l
## To DO 
- we have to implement isolate margin 