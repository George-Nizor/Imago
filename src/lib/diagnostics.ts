export type DiagnosticContext =
  | 'ui'
  | 'cutout'
  | 'beauty'
  | 'export-image'
  | 'export-gif'
  | 'export-frames'
  | 'image-import'
  | 'grade'
  | 'edit'
  | 'storage';

export type NoticeTone = 'info' | 'success' | 'error';

export interface AppNotice {
  id: number;
  tone: NoticeTone;
  message: string;
  detail?: string;
  code?: string;
}

const DIAGNOSTIC_CODES: Record<DiagnosticContext, string> = {
  ui: 'IMAGO-UI-001',
  cutout: 'IMAGO-CUTOUT-001',
  beauty: 'IMAGO-BEAUTY-001',
  'export-image': 'IMAGO-EXPORT-001',
  'export-gif': 'IMAGO-EXPORT-002',
  'export-frames': 'IMAGO-EXPORT-003',
  'image-import': 'IMAGO-IMPORT-001',
  grade: 'IMAGO-GRADE-001',
  edit: 'IMAGO-EDIT-001',
  storage: 'IMAGO-STORAGE-001',
};

export function diagnosticCode(context: DiagnosticContext): string {
  return DIAGNOSTIC_CODES[context];
}

export function makeNotice(
  tone: NoticeTone,
  message: string,
  detail?: string,
  code?: string,
): AppNotice {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    tone,
    message,
    detail,
    code,
  };
}

export function makeErrorNotice(
  context: DiagnosticContext,
  message: string,
  detail = 'Your current composition was left unchanged.',
): AppNotice {
  return makeNotice('error', message, detail, diagnosticCode(context));
}

/** Log only an error category in production; file names and image data stay out of diagnostics. */
export function reportDiagnostic(context: DiagnosticContext, cause: unknown): string {
  const code = diagnosticCode(context);
  const category = cause instanceof Error ? cause.name : typeof cause;
  console.error(`[${code}] ${category}`);
  return code;
}
