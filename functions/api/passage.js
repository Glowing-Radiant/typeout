// GET /api/passage?lang=en|hi — see server/api.js.
import { handlePassage } from '../../server/api.js';

export const onRequestGet = ({ request, env }) => handlePassage(request, env);
