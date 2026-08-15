export interface CvExtractionProvider {
  readonly provider: string;
  readonly model: string;
  extract(cvText: string): Promise<unknown>;
}

function fieldValue(cvText: string, field: RegExp): string | undefined {
  return field.exec(cvText)?.[1]?.trim();
}

function listValue(value: string | undefined): string[] {
  return value
    ? value
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export class DeterministicLocalCvExtractionProvider implements CvExtractionProvider {
  readonly provider = 'local-mock';
  readonly model = 'deterministic-cv-extractor-v1';

  async extract(cvText: string): Promise<unknown> {
    const firstLine = cvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const fullName =
      fieldValue(cvText, /^(?:full\s+name|name)\s*:\s*(.+)$/im) ?? firstLine;
    const skills = listValue(fieldValue(cvText, /^skills\s*:\s*(.+)$/im));
    const years = fieldValue(
      cvText,
      /^years(?:\s+of\s+experience)?\s*:\s*(\d+)$/im,
    );
    const certifications = listValue(
      fieldValue(cvText, /^certifications?\s*:\s*(.+)$/im),
    );

    return {
      fullName,
      skills,
      yearsOfExperience: years === undefined ? 0 : Number(years),
      certifications,
    };
  }
}
