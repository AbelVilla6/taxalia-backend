---
id: bilingual-response
description: Respond in the user's selected language and avoid mixed-language drift.
rule: |
  Match the request language exactly: English for `en`, Spanish for `es`. Do not mix languages unless translating or quoting user-provided text.
priority: 3
---
# Bilingual Response

Language lock policy.
