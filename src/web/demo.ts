/**
 * The scripted demo edit (tests/e2e/demo.json): one real DELETE misroute in the mock run and the two wording
 * changes that fix it. The e2e suite asserts its exact counts; the app offers it as "Try the demo pair".
 */
import demoJson from "../../tests/e2e/demo.json";
import type { OptionText } from "../core/data/criteria.ts";
import { pairKey } from "../core/eval/leakage.ts";

export const DEMO = demoJson as unknown as { pair: [string, string]; edits: Record<string, OptionText> };
export const DEMO_KEY = pairKey(DEMO.pair[0], DEMO.pair[1]);
