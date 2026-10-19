# Report adaptation contract

The retained design reference is `../../work/practwo-materials/reference.docx`
relative to this report directory, downloaded read-only from Drive file
`1ghoHClS0FpzLUlGxLp4xZCyVmfpr1rr4`. Its 36-page Word PDF was rendered and
every page inspected. This is a new-topic adaptation, not an exact textual copy.

## Page and style system

One A4 portrait section. Reference margins: top/bottom 2 cm, left 3 cm,
right 1.5 cm; footer distance 0.882 cm, first-page footer suppressed.
Times New Roman 14 pt, black. Body paragraphs justified, first line about
1.25 cm, 1.15 line spacing. Cover centered, 1.5 spacing; author/supervisor
block right aligned. Main numbered headings centered bold, subsections
left aligned bold. Keep headings with the following paragraph.

Reference has simple gray table headers and visible monochrome borders.
Use the same academic treatment; narrative columns left aligned, numerical
columns centered, vertical alignment centered, repeating headers, no fixed
row heights. Retain the user's previously requested two-part table caption:
table number on the right, descriptive title centered. Figures centered,
caption underneath, bold italic as in the supplied reference. Figure palette
is monochrome, consistent with the reference application requested by the user.
Native Word math is centered with right aligned equation numbers.

## Content slots and intentional replacements

Keep the reference package as the starting document. Retain its page system,
footer/page fields and general academic visual grammar. Adapt the 12 cover
paragraphs to the new topic, known team and new repository. Do not retain
the example's student names or wave-related assertions.

The old body, figures, code listings, tables and bibliography are replaced
because the user explicitly requests complete subject adaptation. New body
has the same nine major roles: task, domain, model, numerical method,
implementation, interface, verification/results, limitations, conclusion.
Add only subheadings needed to explain the 11-state model and the requested
four quarter-interval radar plots. Include actual UI screenshots, figures
recomputed by `scripts/reproduce.py`, and test evidence, never stock images.

The contents page is regenerated with actual heading page numbers. All table
and figure captions receive textual cross references. No copied template
facts, wave screenshots, formula pictures or author names remain.

## Source and validation contract

The supplied assignment defines 11 indicators and Table 1 functions while
its system image contains 13 indicators and inconsistent dependencies.
Implement the complete 11-row table, explicitly documenting the discrepancy.
The only model is (f+ - f-)/S with original signs preserved; there is no
alternate sign convention selector. Missing tabular functions are zero. Initial values,
S parameters and factor levels are illustrative dimensionless assumptions,
not measured or calibrated data. No conversion to casualties, km² or hours.

Numerical report values come from `report/evidence/summary.json` and
`verification.json`. Test counts come from the generated pytest XML and UI
checks JSON, not from a manually typed claim. Every report equation is built
from the production formula strings. Retained reference hashes, page/style
and package inventories are captured in `report/evidence/template-audit.json`.
Styles/theme and footer parts are preserve-only except explicit heading-role
and title-style normalization. Old media relationships may remain unused in
the working copy but no old images may appear in final body.

## Shipping gates

Full backend tests, TypeScript/build, browser workflow, mobile width, exports,
independent analytic and cross-solver checks. Full DOCX render and all-page
PNG inspection, with formula, table, caption, TOC and number cross checks.
Verify GitHub publication after push. Do not claim the source's 13% empirical
error as our result. Do not claim GitHub Pages can execute the Python backend.
