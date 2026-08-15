import { createHash } from 'node:crypto';

import { PDFParse } from 'pdf-parse';
import { raw, type Request, type RequestHandler } from 'express';

import { invalidCvUploadProblem } from '../../infrastructure/http/problem-details.js';

export const CV_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const CV_TEXT_MAX_CHARACTERS = 100_000;

const supportedMediaTypes = ['application/pdf', 'text/plain'] as const;
type CvMediaType = (typeof supportedMediaTypes)[number];

export interface ParsedCvUpload {
  mediaType: CvMediaType;
  contentHash: string;
  text: string;
}

const parseRawCv = raw({
  type: [...supportedMediaTypes],
  limit: CV_UPLOAD_MAX_BYTES,
  inflate: false,
});

export const parseCvUpload: RequestHandler = (request, response, next) => {
  parseRawCv(request, response, (error) => {
    next(error ? invalidCvUploadProblem() : undefined);
  });
};

function mediaTypeFrom(request: Request): CvMediaType {
  const contentType = request.header('content-type')?.split(';', 1)[0]?.trim();

  if (contentType !== 'application/pdf' && contentType !== 'text/plain') {
    throw invalidCvUploadProblem();
  }

  return contentType;
}

async function pdfText(buffer: Buffer): Promise<string> {
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw invalidCvUploadProblem();
  }

  const parser = new PDFParse({ data: buffer });

  try {
    return (await parser.getText()).text;
  } catch {
    throw invalidCvUploadProblem();
  } finally {
    await parser.destroy();
  }
}

function plainText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw invalidCvUploadProblem();
  }
}

export async function readCvUpload(request: Request): Promise<ParsedCvUpload> {
  const mediaType = mediaTypeFrom(request);

  if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
    throw invalidCvUploadProblem();
  }

  const buffer = request.body;
  const text = (
    mediaType === 'application/pdf' ? await pdfText(buffer) : plainText(buffer)
  ).trim();

  if (!text || text.length > CV_TEXT_MAX_CHARACTERS) {
    throw invalidCvUploadProblem();
  }

  return {
    mediaType,
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    text,
  };
}
