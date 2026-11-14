// Supabase Edge Function entry point for frc-data (see handler.ts). The FIRST and Match13 credentials are this
// function's secrets:
//   supabase secrets set FRC_API_USERNAME=… FRC_API_TOKEN=… MATCH13_API_KEY=… --project-ref <project>
// SUPABASE_SERVICE_ROLE_KEY is provided by Supabase; callers must send it as their bearer token.
import { handle } from './handler.ts';

Deno.serve((request: Request) => handle(request, { env: Deno.env.toObject() }));
