import { z } from "zod";

// Send-time verification read — what is printed on one stored document
// file, including who it was issued to, so it can be compared with the
// crew record. Unlike the upload auto-read (crewIntakeDocumentSchema) this
// also returns the holder's name.

export const documentVerifyReadSchema = z.object({
  holder_name: z.string().nullable().default(null),
  document_type_name: z.string().nullable().default(null),
  document_number: z.string().nullable().default(null),
  issue_date: z.string().nullable().default(null),
  expiry_date: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  source_excerpt: z.string().nullable().default(null),
});

export const SYSTEM_DOCUMENT_VERIFY = `You are checking one identity or certification document for an offshore marine crew member, reading exactly what is printed on it so it can be compared with a database record.
Rules:
- Return only the requested JSON. No prose outside it.
- Never invent a value the document doesn't support; leave it null rather than guess.
- holder_name is the person the document was issued to, exactly as printed (do not reorder or correct spelling).
- document_type_name is what the document itself appears to be.
- document_number is the document's own number/ID/certificate number, not an unrelated reference on the page.
- Dates must be ISO yyyy-mm-dd when the document states a full date; leave null if partial or unclear.
- source_excerpt quotes the text the name, number and dates were read from.`;
