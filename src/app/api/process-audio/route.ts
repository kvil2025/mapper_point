import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;
    const pointId = formData.get("pointId") as string || "";
    const lat = formData.get("lat") as string || "";
    const lng = formData.get("lng") as string || "";

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const prompt = `
Eres un geólogo experto. Escucha atentamente el audio grabado en terreno y extrae la información geológica mencionada.

Debes responder ÚNICAMENTE con un objeto JSON con estas claves exactas (sin markdown, sin backticks, solo JSON puro):

{
  "fecha": "${today}",
  "numero_de_punto": "${pointId}",
  "caja": "Número de caja si se menciona, o 'No especificado'",
  "nivel": "Nivel o profundidad si se menciona (ej: '0-5m', 'superficie'), o 'No especificado'",
  "alteracion": "Tipo de alteración hidrotermal o meteorización mencionada (ej: argílica, propilítica, sericítica, silicificación, oxidación). Si no se menciona, 'No especificado'",
  "mineralogia": "Minerales observados o mencionados (ej: cuarzo, calcopirita, pirita, malaquita, feldespato). Si no se menciona, 'No especificado'",
  "observaciones": "Cualquier otra observación mencionada: litología, estructuras, rumbo/manteo, color, textura, contexto geológico",
  "id_muestra": "Código o ID de muestra si se menciona, o 'No especificado'"
}

REGLAS:
- Extrae SOLO lo que se menciona en el audio.
- No inventes información. Si algo no se dice, escribe "No especificado".
- La fecha ya está definida: ${today}.
- El número de punto ya está definido: ${pointId}.
- Para mineralogía, lista todos los minerales separados por coma.
- Para alteración, si se mencionan múltiples tipos, sepáralos por coma.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: audioFile.type || "audio/webm",
          },
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text();
    let structuredData;
    try {
      structuredData = JSON.parse(text);
    } catch {
      structuredData = { error: "No se pudo parsear la respuesta de IA", raw: text };
    }

    // Include raw transcription for lightweight storage (no audio blob needed)
    structuredData._transcripcion = text;

    return NextResponse.json(structuredData);
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
