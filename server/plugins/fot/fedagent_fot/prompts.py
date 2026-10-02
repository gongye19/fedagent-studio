"""FoT 的提示词。

Prompt 1（解题）照抄已审计复现器 run_paper_reproduction.py 的 solve_prompt 和 MATH_SUFFIX；
Prompt 2–5 的模板逐字取自上游 dixiyao/FoT @ b02753c1f7c0946cbec077e737a4acbcb90f9cc0：
- Prompt 2 反思、Prompt 3 提取经验：experiment/client.py 的 _get_reflection_prompt、_get_behavior_prompt；
- Prompt 4 归类、Prompt 5 生成经验库：experiment/server_text.py 的 _get_text_profiling_prompt、_get_knowledge_extraction_prompt。
模板由脚本从上游源码截取（不是手抄），原来 f-string 里的表达式换成了 format 的具名占位；
tests/test_fot_prompts.py 用上游的 f-string 原文核对生成结果逐字相同。
"""

from __future__ import annotations

import json
import math
from typing import Any

MATH_SUFFIX = '\nSolve the problem step by step. Wrap your final answer in "\\boxed{}".'

# Prompt 2：反思（format 占位：problem、solution）
REFLECTION_TEMPLATE = """
Analyze the solution below to extract procedural knowledge that reflect the reasoning traces.

Problem:
{problem}

Step-by-Step Solution:
{solution}

Your task: Extract the fundamental techniques used in reslution that can be packaged as reasoning traces. Focus on:

1. What step-by-step procedures were used? How can these be repeated?
2. What conditions determined which approach to use? When should each technique apply?
3. What methods, strategies, or workflows can be applied to similar problems?
4. What made this approach effective? What should someone know to use it correctly?
5. What types of problems would benefit from these techniques?

Output your analysis covering:

### I. Procedural Knowledge
- Break down the solution into clear, repeatable procedures
- The extracted traces should be concrete solutions rather than general principles.

### II. Reusable Techniques and Methods
- List specific techniques, strategies, or workflows used
- The techniques should be solid on practical questions rather than very general and high-level principles.
- For each technique, identify:
  * When it should be used (conditions/triggers)
  * How it was applied (concrete steps)
  * Why it was effective (insights)
  * What problems it could solve (applicability)

### III. Critical Insights and Guidelines
- What key insights made this solution work?
- What common pitfalls should be avoided?
- What variations or edge cases should be considered?

Focus on extracting actionable, procedural knowledge that can be packaged as reusable insights for similar problems.
"""

# Prompt 3：提取经验（format 占位：problem、solution、reflection）
TRACE_TEMPLATE = """
Extract reasoning traces from the solution below. Analyze the solution and reflection to identify concrete, actionable traces that similar problems can be solved via the traces

Problem: {problem}

Solution: {solution}

Reflection: {reflection}

**Your Task:**
Identify and extract all reusable reasoning traces, techniques, and methods used in the solution. Each trace should be a concrete procedure that can guide someone to solve similar problems.

**What Makes a Good Reasoning Trace:**
- A specific technique or method that was used in the solution.
- Something that can be applied to similar problems, not just this one.
- Includes guidance on when and how to use it with clear steps that can be followed if necessary.
- Not repeatance of already well-known or commonly adopted techniques.
- Not too general and high-level but contains actional procedural knowledge.

**Description Must Include:**
1. **Core idea**: The fundamental concept of what this trace is about. What is the main technique or method? What does it do?

2. **When to use**: Explain when this skill should be applied. What types of problems? What conditions must be met? What situations trigger this skill?

**Output Format (Simple JSON):**
Output a simple JSON object with skill names as keys and descriptions as string values:

{{"trace_name": "description"}}

Format Rules:
- Use valid JSON format
- Each trace name must start with "trace_"
- Keep JSON simple - no nested objects, just key-value pairs
- Escape quotes in descriptions with backslash: \\"

**Example:**
{{
  "trace_polynomialFactoring": "The major idea is how we can turn a polynomial into a product of simpler expressions. This skill is particularly useful for quadratic and higher-degree polynomial equations where factoring can simplify the problem. Factoring reduces complex polynomials to simpler equations. When solving equations with polynomial expressions that can be factored, especially when the polynomial has recognizable patterns like difference of squares (a²-b²), perfect square trinomials (a²±2ab+b²), or common factors.  
  "trace_depthFirstSearchImplementation": "This algorithm is essential for problems involving path finding, cycle detection, topological sorting, connected components, or exploring all possible solutions in a search space. DFS explores depth before breadth, using stack-based recursion or explicit stack. It is memory-efficient for deep structures and naturally handles backtracking. The visited set prevents infinite loops and redundant work. DFS is the foundation for many graph algorithms including topological sort, strongly connected components, and maze solving. When you need to explore or traverse a graph, tree, or nested structure systematically, going as deep as possible before backtracking. Use DFS when you need to visit all nodes in a connected component, find paths between nodes, detect cycles, or explore recursive structures like file systems, nested data, or game states. "
}}

**Output your response as a valid JSON object only:**
"""

# Prompt 4：归类（format 占位：count、insights_text）
PROFILING_TEMPLATE = """
You are analyzing a collection of reasoning traces generated for problem-solving.  Understand their relationships and structure and build a profiling of their relationships.

**Collected {count} traces in total:**
Note: This collection includes ALL traces from all problems without deduplication. Similar names with different indices (e.g., _001, _002) represent different occurrences that may have variations in their descriptions.

{insights_text}

**Your Task:**
Analyze these traces and build a profiling of their relationships:

1. **Identify Clusters**:
   Group related traces that share:
   - Resolve the same or similar problem
   - Similar approaches or techniques
   - Nearly identical traces (e.g., same trace with minor variations in description or parameters)
   - Traces in the same cluster should be higly similar.

2. **Build Trace Relationships**:
Record all important relationships - traces don't exist in isolation and build a relationship graph that records:
   - **Prerequisite relationships**: Traces that must be learned/used before others
   - **Composition relationships**: Traces that can be chained/composed together
   - **Alternative relationships**: Different approaches to the same problem
   - **Complementary relationships**: Traces that work better together than individually used
   - **Derivation relationships**: Traces derived from or based on others
   - **Similar relationships**: Traces that are similar but not identical
Map relationships between traces within clusters and across clusters.

# Output Format:
{{
  "clusters": [
    {{
      "cluster_id": 0,
      "cluster_name": "Domain/Theme Name",
      "traces": ["name1", "name2", "name3"],
      "theme": "What is the high-level techniqual idea of the traces in this cluster?",
    }}
  ],
  "relationships": [
    {{
      "trace_a": "trace_name1",
      "trace_b": "trace_name2",
      "relationship_type": "prerequisite/complementary/alternative/similar/derived_from/composes_with",
      "description": "How these traces relate to each other and Why"
    }}
  ]
}}

**Output your analysis as JSON only:**

"""

# Prompt 5：生成经验库（format 占位：existing、all_insights_text、clusters、relationships、proper_number）
LIBRARY_TEMPLATE = """
**Your Task:**
You are extracting fundamental insights from a collection of problem-solving traces.

**Output Requirements (STRICT):**
1. Return EXACTLY one valid JSON object and nothing else.
2. Do NOT output markdown code fences.
3. Do NOT output explanations, notes, reasoning, prefixes, suffixes, or `<think>` content.
4. Do NOT output list/array at top-level.
5. Every key must start with "insight_".
6. Every value must be a single string.
7. No nested objects, no nested arrays.

**Required JSON shape:**
{{
    "insight_name1": "description string",
    "insight_name2": "description string"
}}

**Formatting Rules:**
- Use valid JSON syntax only.
- Keep top-level as key-value pairs only.
- Escape quotes in descriptions with backslash: \\" 
- If uncertain, still output a valid JSON object (possibly with fewer insights), never free text.

Your goal is to extract a comprehensive set of fundamental, cross-domain insights that can be derived and applied beyond their original domain meet following requirements: 
- Combine previous insights (if any): {existing} with new insights.
- Extract your insights based on all client reasoning traces: {all_insights_text}. These traces are derived from solving specific problems (bottom-up approach)
- Use clusters of reasoning traces: {clusters} to help organize.
- Use relationships between traces: {relationships} to help organization
- Your task is to extract multi-disciplinary, fundamental knowledge (top-down approach) which can be generalized to multi-domain problem-solving.
- The extracted insights should be able to DERIVE and GUIDE the use of the collected insights
- The extraced insights cannot be too general. They are not supposed to be knowledge which can be applied to any problem. They should be fundamental knowlege to particular several domains but specific.
- You should extra {proper_number} insights. Not too few. Not too many.Do not over simplified or too detailed.
- DO NOT over-merge insights.

Insights should have following properties:
1. **Extract Reusable Primitives**:
   - For EACH cluster, extract multiple fundamental insights capturing core essence and variations (DO NOT over-merge)
   - Identify cross-domain patterns that apply to multiple fields
   - Create reusable, composable primitives specific enough to be actionable

2. **Knolwedge to include**:
   - **Fundamental Level**: Core principles underlying multiple domains
   - **General Level**: Broad techniques for related problem types
   - **Cross-Domain**: Insights transferable beyond origin field

3. **Preserve While Generalizing**:
   - Create fundamental versions that can guide/derive original insights
   - Maintain important variations rather than collapsing into single insight

4. **Description Format:**
   Each description is a single string containing:
   - What the insight is and how it solves problems
   - When to use: problem types, conditions, triggers (be comprehensive and specific)

**Example 1 - Transformer Architecture:**

Input reasoning traces:
- reasoning_trace_VisionTransformerImageClassification: "I need to classify medical X-ray images into disease categories. CNNs aren't working well - they can't capture relationships between distant regions like how fluid in the lower right lung might relate to heart enlargement. Let me try Vision Transformer (ViT). I'll divide each X-ray into 16x16 patches - a 224x224 image gives 196 patches. Each patch becomes like a token in NLP. I flatten each to a 256-dim vector. Since transformers don't know spatial positions, I add position embeddings so the model knows patch [0,0] is top-left. I prepend a [CLS] token to gather global info. Feeding through 12 transformer encoder layers - the self-attention lets every patch attend to every other patch directly, so patch [2,5] can look at patch [10,12] even though they're far apart spatially. This is exactly what I need! After 12 layers, I extract the [CLS] token and feed to MLP classifier. Training on 50k chest X-rays: 94.2% accuracy, beating ResNet-50's 89.3%. The attention maps show it's correctly attending to both lungs simultaneously for pneumonia detection, linking heart size to lung fluid - this cross-region reasoning is what CNNs miss. The key: treating image patches as tokens with self-attention enables global spatial reasoning."

- reasoning_trace_TransformerNextWordPrediction: "I'm building autocomplete for a text editor. The challenge: predict next word given arbitrary-length context. RNNs struggle with long sequences - the hidden state forgets earlier context. Let me use a transformer decoder. I tokenize 'The cat sat on the' using WordPiece → tokens [254, 8901, 4523, 651, 278]. Convert each to 512-dim embedding and add positional encodings. Critical part: causal masking so the model can't cheat by seeing future words. When predicting token at position 4, it should only see 0-3. I implement lower-triangular attention mask. Processing through 6 decoder layers with masked self-attention. At position 4 ('the'), attention computes similarity between its query and keys of previous words. It attends strongly to 'sat' (0.8) and 'on' (0.7), weakly to 'cat' (0.2). Using 12 heads helps - different heads capture different patterns: head-2 learns syntax (preposition+article), head-5 learns semantics (actions+objects), head-8 learns long-range dependencies. After final layer, project last hidden state through 50k-dim softmax. For 'the': top predictions are 'mat' (0.73), 'floor' (0.12), 'rug' (0.08). Deployed in production - users accept top-3 suggestion 85% of the time, reducing typing by 40%. Transformer's self-attention captures context way better than RNN's sequential processing."

Output aggregated insight:
{{
  "insight_transformerArchitecture": "This fundamental neural network architecture applies across natural language processing, computer vision, time series analysis, graph neural networks, and multi-modal learning. This insight is essential for modern AI applications including language models, image processing, code generation, and scientific computing. When you need to capture relationships between all elements simultaneously (self-attention), you're working with sequences of variable length, you need parallel processing of sequences, or when the problem involves understanding context and relationships. Details: 1) Design input representation - convert your data into embeddings (token embeddings for text, patch embeddings for images, node embeddings for graphs), add positional encodings to preserve sequence information, and prepare input for transformer blocks 2) Create models with transformer blocks 3) Apply task-specific architecture - use encoder-only for understanding (BERT, ViT), decoder-only for generation (GPT), or encoder-decoder for translation"
}}

**Example 2 - Surface-Enhanced Raman Spectroscopy:**

Input reasoning traces:
- reasoning_trace_SERSMedicalDetectionR6G: "I need to detect cancer biomarkers in blood at incredibly low concentrations - 10^-12 M, like finding molecules in a swimming pool. ELISA only goes to 10^-9 M, not sensitive enough for early diagnosis. Let me try SERS - Surface-Enhanced Raman Spectroscopy. Metal nanoparticles create huge EM field enhancements. I synthesize 60nm gold nanoparticles via citrate reduction. At 785nm laser, these have plasmon resonance amplifying local field by ~10^6. But I need selectivity too - can't detect everything. So I functionalize the gold with anti-PSA antibodies for prostate cancer. When I add patient serum, only PSA proteins bind. Here's the clever part: I add R6G (Rhodamine 6G) reporter molecules. R6G has enormous Raman cross-section and when it sits in nanogaps between gold particles, field enhancement shoots to 10^8 or 10^10. Incubate 30 min for PSA binding, add R6G which sticks near bound PSA. Hit with 785nm laser at 5mW - I see characteristic R6G peaks at 1650, 1510, 1310 cm^-1. Peak intensity directly proportional to PSA amount. Integrate 60 sec for good SNR. Comparing to calibration: detecting PSA at 0.1 ng/mL - that's 10,000x more sensitive than ELISA! On clinical samples, detected prostate cancer 3-6 months earlier than conventional tests. The breakthrough: combining selective antibody recognition with SERS amplification gives single-molecule sensitivity while maintaining specificity."

- reasoning_trace_SERSPollutantDetection: "Monitoring river water for pesticides. EPA limit for malathion is 0.1 ppb but standard chromatography needs 1 ppb minimum. I need 10x better for early warning. SERS might work. Instead of spherical particles, I'll fabricate silver nanorod arrays - sharp tips create hotter hotspots than spheres. Using oblique angle deposition: 80nm nanorods with 4:1 aspect ratio on silicon. Gaps between rods only 5-10nm - perfect for trapping molecules. I calculate enhancement should hit 10^10 at 532nm. Collect river water, filter through 0.2μm to remove debris and bacteria. Drop 50μL onto nanorod substrate. During 5-min adsorption, pesticide molecules diffuse into nanogaps. Small gap means molecules guaranteed in enhancement zone (<10nm from metal). Rinse gently - removes interfering organics/salts but leaves adsorbed pesticides. Excite with 532nm at 2mW, matching silver plasmon peak. Even at 0.01 ppb malathion, clear peaks at 1440 cm^-1 (P=S stretch), 1080 cm^-1 (P-O-C), 640 cm^-1 (C-S). Measuring 1440 peak height vs calibration standards for quantification. Tested 50 river sites, cross-validated against LC-MS: R^2=0.97 correlation. Best part: do this in field with portable Raman - no lab needed. Real-time monitoring at 10x below regulatory limits. The nanorod geometry is critical - those sharp tips and tight gaps push enhancement to 10^10."

Output aggregated insight:
{{
  "insight_surfaceEnhancedRamanSpectroscopy": "This powerful technique applies across analytical chemistry, materials science, biosensing, pharmaceutical analysis, environmental monitoring, and forensics. The technique achieves single-molecule sensitivity (10^6-10^11 enhancement) while providing molecular structural information through vibrational fingerprints. When to use: When you need ultra-sensitive detection below conventional analytical limits, when you want label-free molecular identification, when analyzing trace contaminants or biomarkers, or when field-portable real-time analysis is required. Common steps: 1) Prepare SERS-active substrate - synthesize plasmonic nanostructures (gold/silver nanoparticles, nanorods, nanostars) optimizing particle size (20-100 nm), shape, and inter-particle spacing (1-10 nm gaps) to maximize electromagnetic field enhancement at laser wavelength 2) Functionalize substrate if needed - modify metallic surface with antibodies, aptamers, or molecular recognition elements for selective analyte binding and improved specificity 3) Prepare and apply sample - process sample (filter, dilute, concentrate as needed), deposit onto SERS substrate via drop-casting or flow-through, allow adsorption time for molecules to enter hot spots (<10 nm from metal surface) 4) Select laser parameters - choose wavelength matching plasmon resonance (532, 633, or 785 nm), optimize power (0.1-10 mW) to avoid sample damage while maximizing signal 5) Acquire SERS spectrum - collect Raman scattered light with appropriate integration time, record vibrational spectrum showing characteristic molecular peaks 6) Analyze spectral fingerprint - identify molecules by comparing peak positions to reference spectra, quantify concentration from peak intensities using calibration curves, assess molecular orientation from peak ratios 7) Validate and control quality - average multiple spots for reproducibility, use internal standards, verify with orthogonal methods, consider substrate heterogeneity and enhancement factor variations"
}}
"""

TRACE_DENSITY_MARKER = "\n**Output your response as a valid JSON object only:**"
TRACE_DENSITY_CALIBRATION = """

**Communication-density calibration for model portability:**
- Return at most 1 highest-value reasoning trace for this problem.
- Merge overlapping algebraic steps or closely related micro-techniques into one trace.
- Prefer the decisive reusable method and its required validation/feasibility checks.
- Preserve important failure conditions, counterexamples, and when-not-to-use guidance.
- Do not create one trace for every routine calculation in the solution.
"""

PAPER_AUTO_INSTRUCTION = "- You should extract proper number of insights. Not too few. Not too many. Do not over simplify or be too detailed."


def problem_text(question: str) -> str:
    """复现器 Item.problem：题目后接数学题的作答要求。"""
    return question + MATH_SUFFIX


def solve_prompt(problem: str, library: dict[str, str]) -> str:
    """Prompt 1；没有经验库时就是 Problem: {problem}。"""
    insights_section = ""
    if library:
        insights_text = "\n\n".join(f"**{name}**:\n{description}" for name, description in library.items())
        insights_section = f"""Available Insights to Guide Your Solution:

{insights_text}

---
INSTRUCTIONS: Review the insights above and actively apply the relevant techniques from insights to solve this problem. Consider which insights can help you approach the problem more effectively.

"""
    return f"{insights_section}Problem: {problem}"


def reflection_prompt(problem: str, solution: str) -> str:
    return REFLECTION_TEMPLATE.format(problem=problem, solution=solution)


def trace_prompt(problem: str, solution: str, reflection: str, density: str = "native") -> str:
    """Prompt 3。density 为 paper-gemini 时加上复现器的"每题至多一条"校准说明（不是论文原文，复现器明确标注过）。"""
    prompt = TRACE_TEMPLATE.format(problem=problem, solution=solution, reflection=reflection)
    if density == "native":
        return prompt
    if density != "paper-gemini":
        raise ValueError(f"unsupported trace density mode: {density}")
    if TRACE_DENSITY_MARKER not in prompt:
        raise RuntimeError("could not apply trace-density calibration to Prompt 3")
    return prompt.replace(TRACE_DENSITY_MARKER, TRACE_DENSITY_CALIBRATION + TRACE_DENSITY_MARKER, 1)


def profiling_prompt(trace_store: dict[str, str]) -> str:
    insights_text = "\n".join(f"- {name}: {desc}" for name, desc in trace_store.items())
    return PROFILING_TEMPLATE.format(count=len(trace_store), insights_text=insights_text)


def released_count(trace_count: int) -> Any:
    """上游 server_text.py 的条数公式：int(log10(trace 条数) * 10 + 1)。"""
    return int(math.log10(trace_count) * 10 + 1) if trace_count > 0 else "a reasonable number"


def library_prompt(
    trace_store: dict[str, str],
    profiling: dict[str, Any],
    previous_library: dict[str, str],
    insight_target: str = "paper-auto",
) -> str:
    """Prompt 5。

    insight_target：
    - author-formula：上游源码原样，条数用 log10 公式；
    - paper-auto（默认）：论文附录 G 的写法"proper number"，把条数那一行换成复现器的 PAPER_AUTO_INSTRUCTION；
    - 11、37 等数字：固定条数的对比实验，按上游 --num-insights 的方式填入条数。
    """
    clusters_text = ""
    if isinstance(profiling, dict) and "clusters" in profiling:
        clusters_text = "\n".join(
            f"- Cluster {cluster.get('cluster_id', '?')} ({cluster.get('cluster_name', 'unnamed')}): {', '.join(cluster.get('insights', []))}"
            for cluster in profiling["clusters"]
        )
    all_insights_text = ";".join(f"{name}: {desc}" for name, desc in trace_store.items())
    relationships = json.dumps(profiling.get("relationships", []), indent=2) if isinstance(profiling, dict) else "None identified"
    existing = json.dumps(previous_library, indent=2, ensure_ascii=False) if previous_library else ""
    if insight_target in ("paper-auto", "author-formula"):
        proper_number: Any = released_count(len(trace_store))
    else:
        proper_number = int(insight_target)
    prompt = LIBRARY_TEMPLATE.format(
        existing=existing if existing else "None",
        all_insights_text=all_insights_text,
        clusters=clusters_text if clusters_text else "None identified",
        relationships=relationships,
        proper_number=proper_number,
    )
    if insight_target != "paper-auto":
        return prompt
    line = f"- You should extra {proper_number} insights. Not too few. Not too many.Do not over simplified or too detailed."
    if line not in prompt:
        raise RuntimeError("could not apply the paper-auto instruction to Prompt 5")
    return prompt.replace(line, PAPER_AUTO_INSTRUCTION, 1)
