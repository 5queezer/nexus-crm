const EMBEDDING_MODEL = "text-embedding-3-small";

export async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data[0].embedding as number[];
  } catch {
    return null;
  }
}

export function applicationEmbeddingText(app: {
  company: string;
  role: string;
  notes?: string | null;
  jobDescription?: string | null;
}): string {
  return [
    `Company: ${app.company}`,
    `Role: ${app.role}`,
    app.notes ? `Notes: ${app.notes}` : null,
    app.jobDescription ? `Job Description: ${app.jobDescription.slice(0, 4000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function experienceEmbeddingText(exp: {
  company: string;
  title: string;
  date: string;
  location: string;
  bullets: string[];
}): string {
  return [
    `Company: ${exp.company}`,
    `Title: ${exp.title}`,
    `Date: ${exp.date}`,
    `Location: ${exp.location}`,
    exp.bullets.length
      ? `Achievements:\n${exp.bullets.map((b) => `- ${b}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
