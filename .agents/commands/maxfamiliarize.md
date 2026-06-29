---
description: Become maximally familiarized with the codebase source
---

Run the following command to learn about all the packages in this repository and all source code files in each package:
```bash
find packages -path '*/node_modules' -prune -o -path '*/dist' -prune -o -type f \( -path '*/src/*' -o -path '*/test/*' \) -print | sort
```

You MUST read all files IN PARALLEL before any analysis. Do not drip-read and think between batches. If parallel-call limits fail, split into the fewest batches needed.
