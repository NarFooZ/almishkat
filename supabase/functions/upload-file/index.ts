// Upload file via service_role key (bypasses RLS for anon users)
// Expects multipart/form-data with fields: bucket, file
// Returns: { success: true, url: string, fileName: string }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_BUCKETS = ["voice-notes", "attachments", "print-files"];

serve(async (req) => {
  try {
    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, apikey",
        },
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const bucket = formData.get("bucket")?.toString() || "";
    const fileField = formData.get("file");

    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return new Response(
        JSON.stringify({ success: false, error: `المجلد "${bucket}" غير مسموح. المسموح: ${ALLOWED_BUCKETS.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
    }

    if (!fileField || !(fileField instanceof File)) {
      return new Response(JSON.stringify({ success: false, error: "الملف مطلوب" }), {
        status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const file = fileField as File;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\u0600-\u06ff_-]/g, "_");
    const storagePath = `${Date.now()}_${safeName}`;

    // Create Supabase client with service_role key
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Upload file
    const { data, error } = await sb.storage.from(bucket).upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Get public URL
    const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(storagePath);

    return new Response(JSON.stringify({ success: true, url: publicUrl, fileName: storagePath }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message || "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});