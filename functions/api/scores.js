// GET and POST /api/scores — see server/api.js.
import { handleScoresGet, handleScoresPost } from '../../server/api.js';

export const onRequestGet = ({ request, env }) => handleScoresGet(request, env);
export const onRequestPost = ({ request, env }) => handleScoresPost(request, env);
