import type { ChatMessage } from "../../api/consultation";

// 保留对照实测的输入，两个窗口可以按同一顺序补充资料。
const PRETERM_SAMPLE = [
  {
    label: "早产儿惊厥",
    text: [
      "Simulated consultation case. Here is the history and the available physical exam.",
      "Demographics: 1100-g (2-lb 7-oz) newborn, 31 weeks' gestation",
      "History: The patient was born three days ago with a birth weight of 1100 g at 31 weeks' gestation. The antenatal period was complicated by chorioamnionitis. Apgar scores were 3 and 6 at 1 and 5 minutes, respectively. The patient has become increasingly lethargic over the past 18 hours and experienced a tonic seizure lasting for 25 seconds.",
      "Past Medical History: Premature birth at 31 weeks' gestation. Antenatal complications included chorioamnionitis.",
      "Review of Systems / Cardiovascular: Pulse is 123/min",
      "Review of Systems / Neurological: Seizure, lethargy, slow conjugate back and forth movements of the eyes, decreased muscle tone in all extremities",
      "Review of Systems / Other: Tense anterior fontanelle, pupils equal and react sluggishly to light",
      "Review of Systems / Respiratory: Respirations are 50/min and irregular",
      "Social History: Not applicable given age",
      "Symptoms / Primary Symptom: Tonic seizure lasting for 25 seconds",
      "Symptoms / Secondary Symptoms: Increasing lethargy over the past 18 hours",
      "Symptoms / Secondary Symptoms: Appears ill",
      "Physical exam:",
      "Neurological Examination / Consciousness Level: Lethargic",
      "Neurological Examination / Eye Movements: Slow, conjugate back and forth movements",
      "Neurological Examination / Fontanelle: Tense anterior fontanelle",
      "Neurological Examination / Muscle Tone: Decreased in all extremities",
      "Neurological Examination / Pupil Reactivity: Sluggish",
      "Respiratory Examination / Lung Auscultation: Clear to auscultation",
      "Vital Signs / Blood Pressure: 60/30 mm Hg",
      "Vital Signs / Heart Rate: 123 bpm",
      "Vital Signs / Respiratory Rate: 50 breaths/min",
      "Which department should see this patient now, and what is the single most likely working diagnosis? Start with 'Working diagnosis:' and one leading diagnosis if justified, or 'Working diagnosis: uncertain'. Briefly explain the supplied findings supporting it and any key information still needed.",
    ].join("\n"),
  },
  {
    label: "补充化验结果",
    text: [
      "Additional case information: C-reactive protein is elevated, the white blood cell count is slightly elevated, and hemoglobin is within normal limits.",
      "Cranial imaging is not available yet.",
      "Based only on the supplied findings, state one leading working diagnosis, or say uncertain.",
      "If a test is needed, name the one most useful for distinguishing the leading possibilities.",
    ].join(" "),
  },
  {
    label: "补充颅脑超声",
    text: [
      "The cranial ultrasound is now available.",
      "The report describes blood within the ventricles.",
      "Based on this new result and the preceding information, state the single leading diagnosis and indicate whether the new finding supports it.",
    ].join(" "),
  },
];

const EAR_PAIN_SAMPLE = {
  label: "进食时右耳电击痛",
  text: [
    "Simulated case. A 25-year-old woman has occasional shooting pain in her right ear when she eats.",
    "She had her right eardrum repaired 12 weeks ago for recurrent ear infections, and her hearing has improved. Earrings also cause discomfort.",
    "She reports no fever, neck pain, facial tenderness, or dizziness. Her jaw does not click and is not tender. Tapping behind the right ear elicits tenderness in the right tonsillar region.",
    "Which department should see her now? Give one leading working diagnosis, or say uncertain if the facts do not support one, and briefly explain your reasoning.",
  ].join(" "),
};

export const SAMPLE_QUESTIONS = [PRETERM_SAMPLE[0], EAR_PAIN_SAMPLE];

export function nextSampleDetail(messages: readonly ChatMessage[]) {
  const userTurns = messages.filter(({ role }) => role === "user");
  const next = PRETERM_SAMPLE[userTurns.length];
  if (!userTurns.length || !next) return undefined;
  return userTurns.every(({ content }, index) => content === PRETERM_SAMPLE[index].text) ? next : undefined;
}
