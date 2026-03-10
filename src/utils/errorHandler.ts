import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const AGENT_CMD = 'agent';
const AGENT_PROMPT =
  'Fix the error described below and commit the changes to the repository.\n\n<error details>';

export const handleError = (error: Error) => {
  console.error(error);
  const content = [error.message, error.stack].filter(Boolean).join('\n\n');
  writeFileSync('error.log', content);

  const prompt = AGENT_PROMPT.replace('<error details>', content);

  const child = spawn(AGENT_CMD, ['-f', '-p', prompt], {
    stdio: 'inherit',
    shell: true,
    detached: true,
  });
  child.unref();
};