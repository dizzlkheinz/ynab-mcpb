# Demo Asset Guide

Use this folder for short demo clips referenced by the main `README.md`.

## Recommended demos

1. `receipt-itemization-demo.gif`
   - Show: paste receipt text, run tool, resulting split transaction
   - Target length: 10-20 seconds
2. `reconciliation-demo.gif`
   - Show: upload CSV, match results, apply suggested changes
   - Target length: 15-30 seconds

## Recording tips

- Keep resolution around 1280x720 or lower
- Crop to only the relevant UI area
- Use 2x speed if the workflow is slow
- Blur/redact budget names and merchant details if needed

## Prompt script for true itemization demo

Use this exact prompt so the assistant is forced to use the itemization tool:

```text
receipt.png
Use YNAB MCP.
Call create_receipt_split_transaction (not create_transaction).
Return the final response including receipt_summary and subtransactions.
```

If the assistant does not mention `create_receipt_split_transaction`, stop and rerun with stricter wording.

## Quick conversion (ffmpeg)

Convert MP4 to optimized GIF:

```bash
ffmpeg -i input.mp4 -vf "fps=10,scale=960:-1:flags=lanczos" -loop 0 output.gif
```

For better quality/size tradeoff:

```bash
ffmpeg -i input.mp4 -vf "fps=12,scale=960:-1:flags=lanczos,palettegen" -y palette.png
ffmpeg -i input.mp4 -i palette.png -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 output.gif
```
