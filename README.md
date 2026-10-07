# RD BOM Compare Tool

Browser-side tool for verifying **RD Difference BOM** against an **Agile released BOM report**, while hiding fields that do not matter to RD verification.

## V0.1 scope

- Supports `.xls` / `.xlsx` through SheetJS in the browser.
- Files stay on the user's PC; no BOM content is uploaded to a server.
- Auto-detects Agile parent Part Number and derives scope such as `8C` / `8D`.
- RD comparison key: `Scope + Ref Des + Part Number`.
- Checks Add / Delete changes.
- Result: `PASS`, `FAIL`, `WARNING`, `OUT OF SCOPE`.
- Quantity mismatch becomes a warning when Part Number + Ref Des are correct.
- Description is not a hard-fail key in V0.1.
- Exports Summary + Results to Excel.

## Intentionally ignored Agile fields

Cost, MOQ, Country of Origin, Dchain status, Certificate, Weight, Manufacturer Description and other non-RD verification fields.

## Run

For quick local use, serve the folder with any static HTTP server, e.g. VS Code Live Server or:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

This project is static and can be published directly from the repository root using GitHub Pages.
For company production use, consider vendoring the pinned SheetJS file instead of loading it from a public CDN.

## Security rule

**Never commit actual company BOM / ECO files.** `.gitignore` blocks common spreadsheet formats by default.

## Compare rule V0.1

```text
Agile Parent PN -> derive Target Scope (e.g. 8C)
        |
        +-- RD rows in target scope -> compare
        +-- RD rows in other scope  -> OUT OF SCOPE

ADD:    expected PN must exist at every RD Ref Des
DELETE: old PN must no longer exist at every RD Ref Des
QTY:    warning when Part/Ref match but quantity differs
```

## Test

```bash
npm test
```

The unit tests cover Ref Des normalization, 8C/8D scope, side-by-side RD blocks, Add/Delete, out-of-scope and wrong-part failure.
