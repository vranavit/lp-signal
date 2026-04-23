"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Shared server action: given a document_id, return a short-lived signed URL
// for the backing PDF in Storage. Works for both signals (from board minutes)
// and pension allocations (from CAFRs). Falls back to source_url (the public
// scrape source) when the PDF isn't in Storage or signing fails.

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes — long enough to click-through, short enough to avoid leakage.

export type SourceInfo = {
  documentId: string;
  docType: string | null;
  sourceUrl: string | null;
  storagePath: string | null;
  meetingDate: string | null;
  signedUrl: string | null;
  signedUrlError: string | null;
};

export async function getSourceInfo(
  documentId: string,
): Promise<SourceInfo | null> {
  const supabase = createSupabaseAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, document_type, source_url, storage_path, meeting_date")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return null;

  let signedUrl: string | null = null;
  let signedUrlError: string | null = null;
  if (doc.storage_path) {
    const { data: signed, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    if (error) {
      signedUrlError = error.message;
    } else {
      signedUrl = signed?.signedUrl ?? null;
    }
  }

  return {
    documentId: doc.id,
    docType: doc.document_type,
    sourceUrl: doc.source_url,
    storagePath: doc.storage_path,
    meetingDate: doc.meeting_date,
    signedUrl,
    signedUrlError,
  };
}
