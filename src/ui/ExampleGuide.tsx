import type {ExampleId} from './preview';
import type {Labels, Language} from './i18n';
import {experimentFor} from './example-guide';
export function ExampleGuide({example, text, language}: {example: ExampleId; text: Labels; language: Language}) {
  const experiment = experimentFor(example, language);
  return <section className="example-guide" aria-labelledby="example-guide-title" data-example-guide={example}>
    <h2 id="example-guide-title">{text.experimentTitle}</h2>
    <p className="comparison-help">{text.experimentBaseline}</p>
    <div className="experiment-steps">
    <p className="experiment-question"><strong>{text.predict}:</strong> {experiment.question}</p>
    <p><strong>{text.tryExperiment}:</strong> {experiment.action}</p>
    <p><strong>{text.watchExperiment}:</strong> {experiment.watch}</p>
    </div>
    <details><summary>{text.experimentExplanation}</summary><div className="experiment-explanation"><p>{experiment.explanation}</p><p className="comparison-help">{text.comparisonHelp}</p></div></details>
  </section>;
}
