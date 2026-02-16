# LLM SPEC — Structure-Driven Development (SDD)

This document is for AI code generation only.
Human explanations are intentionally omitted.

---

## 0. Core Rule

Structure is the single source of truth (SSOT).

Never modify behavior outside:

- L2
- L3
- L4
- OpenAPI

If structure is inconsistent → do not guess → stop.

---

## 1. Layer Model

```txt
L3.action
  → L2.transition.id
    → L4.events key
      → L4.data.{queries|mutations} key
        → OpenAPI.operationId
```

This chain must be preserved exactly.

No shortcuts.
No URL usage.
No HTTP literal usage.

---

## 2. Hard Constraints

## L2

- screen.id unique
- context creates variants
- entry may be multiple
- screen unreachable from entry = invalid structure

## L3

- action MUST equal L2.transition.id
- screen MUST exist in L2

## L4

- screenKey MUST exist in L2
- events keys MUST match L2.transition.id
- callQuery.query MUST exist in data.queries
- callMutation.mutation MUST exist in data.mutations

## OpenAPI

- operationId required
- operationId unique
- L4.operationId MUST exist
- If selectRoot exists → it MUST be a valid root key of OpenAPI response schema

## i18n

- title key required
- component label key required
- ja is base locale

---

## 3. Forbidden

- Direct URL reference
- HTTP method reference
- Hardcoded endpoint
- Implicit transitions
- Implicit state change
- Using data not declared in L4
- Generating screens not declared in L2
- Creating API calls not declared in L4

---

## 4. Generation Policy

When generating:

1. Read L2 → determine navigation
2. Read L4 → determine data contract
3. Use operationId only
4. Assume ApiResponse\<T\> unless specified otherwise
5. Do not invent structure
6. If missing → report structure error

---

## 5. Error Handling

If structure invalid:

- Do not auto-fix
- Do not hallucinate
- Return explanation of mismatch

---

## 6. Implementation Scope

Generated code may:

- Bind UI to L4 queries/mutations
- Dispatch transition events
- Map selectRoot to response data

Generated code may NOT:

- Change structure
- Add transitions
- Add queries
- Add mutations

---

## 7. Mental Model

Structure defines:

- Navigation graph
- State contract
- API contract
- UI contract

Code is projection of structure.

Never treat code as source of truth.
