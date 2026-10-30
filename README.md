# Polyform

**Trade beyond the ordinary.**

[![Live site](https://img.shields.io/badge/live-polyform.cash-1b89f4)](https://polyform.cash)
![Chain](https://img.shields.io/badge/chain-Solana-93dcfb)

Polyform is a live board for Solana: the busiest tokens of the day, ranked and refreshed in one calm view.

| | |
|---|---|
| Chain | Solana |
| Contract address | `pending` |
| Site | https://polyform.cash |

## Overview

A static site with a live market panel. The page reads a small register of project facts (chain, contract address, social profiles, market feed). Anything not yet stated stays visibly inert, with no placeholder value and no link.

## Features

- Top ten Solana tokens by 24 hour volume, with price, 24 hour move, volume, liquidity and a copy control for each address
- Scrolling price ticker built from the same data
- Polling every 60 seconds, paused while the tab is hidden, with exponential backoff and last good data kept on failure
- Contract address slot pinned to the top of the page, ready to copy once stated
- Spring-based entrance motion, hero parallax, spotlight hover, and a full reduced-motion fallback

## Links

- Site: https://polyform.cash
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm install
npm run build     # writes dist/
npm run gates     # checks dist/ and proves both register branches
npm run serve     # serves dist/ on http://localhost:4173
```

Deploy the contents of `dist/`.

## License

MIT, see [LICENSE](LICENSE).
