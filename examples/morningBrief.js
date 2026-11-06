// Prints a little morning brief: date, local weather, and today's to-dos.
//   node examples/morningBrief.js "water plants" "call mum"
import { connectPrinter } from 'catprinter';

const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const weatherLine = await fetch('https://wttr.in/?format=%l:+%C+%t')
  .then((weatherResponse) => weatherResponse.text())
  .catch(() => 'weather unavailable');
const toDoLines = process.argv.slice(2).map((toDoItem) => `[ ] ${toDoItem}`);

const morningBriefText = ['GOOD MORNING', todayLabel, '', weatherLine.trim(), '', ...toDoLines].join('\n');

const printer = await connectPrinter();
await printer.printText(morningBriefText);
await printer.disconnect();
process.exit(0);
