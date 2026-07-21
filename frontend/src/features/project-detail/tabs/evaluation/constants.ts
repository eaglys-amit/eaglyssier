import type { Grade } from "@/types/api";

/** FORM② axes — labels/buckets/questions mirror app/services/evaluation_prompts.py. */
export const AXES: { key: string; label: string; bucket: string; hint: string }[] = [
  {
    key: "outcomes",
    label: "Outcomes",
    bucket: "Feasibility",
    hint: "Expected deliverables, defined as a completed state",
  },
  {
    key: "value",
    label: "Value (Business Impact)",
    bucket: "Unique",
    hint: "Benefit the outcomes bring to the organization or customers",
  },
  {
    key: "cost",
    label: "Cost",
    bucket: "Feasibility",
    hint: "Focus Factor / human-hours / capital investment, stated numerically",
  },
  {
    key: "quality",
    label: "Quality",
    bucket: "Unique",
    hint: "Measurable quality standards (e.g. test coverage thresholds)",
  },
  {
    key: "delivery",
    label: "Delivery",
    bucket: "Feasibility",
    hint: "Deadlines, milestones, and adaptability to change",
  },
  {
    key: "ownership",
    label: "Ownership",
    bucket: "Inclusive",
    hint: "Accountability (incl. AI-generated code) and team contribution",
  },
];

/** S–E achievement scale from the MBO sheet (B = goal achieved as planned). */
export const GRADES: { value: Grade; label: string }[] = [
  { value: "S", label: "S (120)" },
  { value: "A", label: "A (110)" },
  { value: "B", label: "B (100)" },
  { value: "C", label: "C (90)" },
  { value: "D", label: "D (80)" },
  { value: "E", label: "E (70)" },
];

/** Checklist item id prefix -> group heading (order matters for display). */
export const CHECKLIST_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "O", label: "Outcomes (Feasibility≒)" },
  { prefix: "V", label: "Value — Business Impact (Unique≒)" },
  { prefix: "C", label: "Cost (Feasibility≒)" },
  { prefix: "Q", label: "Quality (Unique≒)" },
  { prefix: "D", label: "Delivery (Feasibility≒)" },
  { prefix: "W", label: "Ownership (Inclusive≒)" },
  { prefix: "G", label: "Overall Consistency" },
];
