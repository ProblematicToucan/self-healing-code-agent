import { writeFileSync } from 'node:fs';


export const handleError = (error: Error) => {
  console.error(error);
  const content = [error.message, error.stack].filter(Boolean).join('\n\n');
  writeFileSync('error.log', content);
};