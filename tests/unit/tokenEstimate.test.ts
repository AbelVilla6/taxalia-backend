import { describe, expect, it } from 'vitest';
import { Ollama } from 'ollama';
import {
  MODEL,
  TOKEN_ESTIMATE_CHARS_PER_TOKEN,
  TOKEN_ESTIMATE_PROMPT_OVERHEAD,
  tokenEstimate,
} from '../../src/ollama/models.js';

describe('tokenEstimate', () => {
  it('pins the Ollama model to gemma4:e4b', () => {
    expect(MODEL).toBe('gemma4:e4b');
  });

  it('uses the calibrated conservative estimate for bilingual samples', () => {
    const samples = [
      'Taxalia can help with advisory services.',
      'Taxalia puede ayudarte con servicios financieros.',
      'Valuation requires revenue, margin, growth, and risk assumptions.',
      'La valoración requiere ingresos, margen, crecimiento y riesgo.',
    ];

    for (const sample of samples) {
      expect(tokenEstimate(sample)).toBe(
        Math.ceil(sample.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN + TOKEN_ESTIMATE_PROMPT_OVERHEAD),
      );
    }
  });

  const liveIt = process.env.RUN_LIVE_OLLAMA_TESTS === '1' ? it : it.skip;

  liveIt('stays within 15% of live Ollama promptEvalCount on bilingual samples', async () => {
    const ollama = new Ollama({ host: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434' });
    const samples = [
      'Taxalia can help founders understand valuation assumptions before a transaction.',
      'Taxalia puede orientar a empresas familiares antes de una venta o reorganización.',
      'Please explain the engagement model and when a human advisor should review my case.',
      'Necesito saber qué información financiera preparar antes de hablar con un asesor.',
      'Advisory services help leadership teams compare strategic options before acting.',
      'Los servicios de asesoría ayudan a ordenar prioridades antes de tomar decisiones.',
      'A valuation discussion usually starts with revenue, margin, growth, and risk.',
      'Una conversación de valoración suele empezar por ingresos, margen y crecimiento.',
      'Please capture my contact intent and tell me what information to prepare.',
      'Quiero dejar mis datos de contacto y saber qué preparar para la reunión.',
      'Explain when a human advisor should review personalized tax information.',
      'Explicá cuándo una persona debe revisar información fiscal personalizada.',
      'Summarize the difference between general information and regulated advice.',
      'Resumí la diferencia entre información general y asesoramiento regulado.',
      'Help me understand whether my company is ready for a transaction process.',
      'Ayudame a entender si mi empresa está lista para un proceso de venta.',
      'What does Taxalia need before estimating a valuation range?',
      '¿Qué necesita Taxalia antes de estimar un rango de valoración?',
      'Tell me the next step without requesting unnecessary personal data.',
      'Decime el próximo paso sin pedir datos personales innecesarios.',
    ];

    for (const sample of samples) {
      const response = await ollama.generate({
        model: MODEL,
        prompt: sample,
        options: { num_predict: 1 },
        stream: false,
      });
      const actual = (response as unknown as { prompt_eval_count?: number }).prompt_eval_count;
      expect(actual, 'Ollama response must include prompt_eval_count').toBeTypeOf('number');
      const relativeError = Math.abs(tokenEstimate(sample) - actual!) / actual!;
      expect(relativeError).toBeLessThanOrEqual(0.15);
    }
  });
});
