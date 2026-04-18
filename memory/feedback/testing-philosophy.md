---
name: Testing Philosophy
description: Write load-bearing tests for integrated behavior and side effects, not trivial property-setting unit tests
type: feedback
---

Tests should be load-bearing: verify that a larger integrated piece ships correctly, or catch unintended side effects from interactions. Don't write tests that just verify TypeScript works (property assignment, type narrowing, etc.).

**Why:** Trivial tests for simple classes (e.g., "it stores entityId") test the language, not the system. They add maintenance cost without catching real bugs.

**How to apply:** Skip tests for simple data-holding classes. Write tests at the integration/E2E level where multiple components interact and real game actions produce observable results. E2E event tests are a good example — they test that real game actions produce correct structured events through the full pipeline.
