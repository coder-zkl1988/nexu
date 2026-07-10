import type { TeamWorkflowTemplate } from "@nexu/shared";

/**
 * Starter SOP templates. DAG shapes are adapted from proven multi-agent
 * workflow patterns (see specs/design-docs/2026-07-01-team-workflow-sop-and-
 * autocompose.md P4); step tasks are written for Nexu's expert catalog —
 * assignee slugs must exist there (guarded by a unit test). Each step ends by
 * demanding a clean deliverable so downstream `{{var}}` injection stays free
 * of meta commentary.
 */
export const TEAM_WORKFLOW_TEMPLATES: TeamWorkflowTemplate[] = [
  {
    id: "xiaohongshu-viral-note",
    name: "小红书爆款笔记",
    description:
      "主题 → 策略分析 → 正文与标题标签并行创作 → 整合成可直接发布的笔记",
    inputs: [
      { name: "topic", description: "笔记主题", required: true },
      {
        name: "target_audience",
        description: "目标人群",
        required: false,
        default: "小红书主流用户",
      },
    ],
    steps: [
      {
        id: "strategy",
        type: "task",
        assigneeSlug: "marketing-xiaohongshu-specialist",
        name: "策略分析",
        task: [
          "针对主题「{{topic}}」制定小红书爆款策略，目标人群：{{target_audience}}。",
          "依次给出：可行的切入角度（含理由）、要调动的用户情绪、正文结构建议、一个促进评论或收藏的互动点。",
          "只输出策略本身，不要寒暄。",
        ].join("\n"),
        output: "strategy",
        dependsOn: [],
      },
      {
        id: "copy",
        type: "task",
        assigneeSlug: "marketing-content-creator",
        name: "正文创作",
        task: [
          "按下面的策略写一篇小红书笔记正文（500-700 字），第一人称、开头一句抓住注意力、分小节、适度使用 emoji、结尾引导互动。",
          "策略：\n{{strategy}}",
          "只输出正文。",
        ].join("\n"),
        output: "post_body",
        dependsOn: ["strategy"],
      },
      {
        id: "title",
        type: "task",
        assigneeSlug: "marketing-baidu-seo-specialist",
        name: "标题与标签",
        task: [
          "围绕主题「{{topic}}」和下面的策略，给出 5 个候选标题（≤20 字）、1 个推荐标题（说明理由）、10 个按相关性排序的话题标签（#格式）。",
          "策略：\n{{strategy}}",
          "只输出标题与标签清单。",
        ].join("\n"),
        output: "title_and_tags",
        dependsOn: ["strategy"],
      },
      {
        id: "final",
        type: "task",
        assigneeSlug: "marketing-content-creator",
        name: "整合成稿",
        task: [
          "把标题标签与正文整合成一篇可直接发布的小红书笔记，按【标题】/【正文】/【话题标签】/【发布建议】四段输出。",
          "标题与标签：\n{{title_and_tags}}",
          "正文：\n{{post_body}}",
          "只输出成稿本身。",
        ].join("\n"),
        output: "final_post",
        dependsOn: ["copy", "title"],
      },
    ],
    requiredExperts: [
      "marketing-xiaohongshu-specialist",
      "marketing-content-creator",
      "marketing-baidu-seo-specialist",
    ],
  },
  {
    id: "tech-blog",
    name: "技术博客创作",
    description: "一句话选题 → 调研 → 大纲 → 带代码示例的初稿 → 发布级润色",
    inputs: [
      { name: "topic", description: "博客主题（一句话）", required: true },
      {
        name: "audience",
        description: "目标读者",
        required: false,
        default: "有一定经验、想兼顾原理与实践的开发者",
      },
    ],
    steps: [
      {
        id: "research",
        type: "task",
        assigneeSlug: "product-trend-researcher",
        name: "选题调研",
        task: [
          "调研主题「{{topic}}」，读者是{{audience}}。",
          "给出：核心论点、支撑论据或数据、读者最关心的 2-3 个问题、可引用的现实案例。",
          "只输出调研简报。",
        ].join("\n"),
        output: "research_brief",
        dependsOn: [],
      },
      {
        id: "outline",
        type: "task",
        assigneeSlug: "engineering-technical-writer",
        name: "大纲设计",
        task: [
          "基于调研简报为「{{topic}}」设计博客大纲：各节标题、每节要点、代码示例应放在哪些小节。",
          "调研简报：\n{{research_brief}}",
          "只输出大纲。",
        ].join("\n"),
        output: "outline_doc",
        dependsOn: ["research"],
      },
      {
        id: "draft",
        type: "task",
        assigneeSlug: "engineering-senior-developer",
        name: "初稿撰写",
        task: [
          "按大纲写出完整博客初稿，代码示例要可运行、贴合论点。",
          "调研简报：\n{{research_brief}}",
          "大纲：\n{{outline_doc}}",
          "只输出初稿全文。",
        ].join("\n"),
        output: "blog_draft",
        dependsOn: ["research", "outline"],
      },
      {
        id: "polish",
        type: "task",
        assigneeSlug: "engineering-technical-writer",
        name: "发布润色",
        task: [
          "把初稿润色到可发布标准：行文流畅、术语一致、段落节奏得当，保留全部代码示例。",
          "初稿：\n{{blog_draft}}",
          "只输出润色后的成稿。",
        ].join("\n"),
        output: "final_blog",
        dependsOn: ["draft"],
      },
    ],
    requiredExperts: [
      "product-trend-researcher",
      "engineering-technical-writer",
      "engineering-senior-developer",
    ],
  },
  {
    id: "academic-paper-outline",
    name: "学术论文选题与大纲",
    description: "研究方向 → 选题评估 → 方法论与文献框架并行 → 完整大纲",
    inputs: [
      {
        name: "research_topic",
        description: "研究主题或初步方向",
        required: true,
      },
      {
        name: "discipline",
        description: "学科（如 计算机科学 / 教育学）",
        required: true,
      },
    ],
    steps: [
      {
        id: "topic_eval",
        type: "task",
        assigneeSlug: "academic-study-planner",
        name: "选题评估",
        task: [
          "评估研究主题「{{research_topic}}」在 {{discipline}} 领域的可行性：创新性、可行性、理论与实践价值各给出判断与理由；提炼 1 个核心研究问题和 2-3 个子问题；如主题过宽或过窄给出调整建议。",
          "只输出评估结论。",
        ].join("\n"),
        output: "topic_evaluation",
        dependsOn: [],
      },
      {
        id: "methodology",
        type: "task",
        assigneeSlug: "academic-study-planner",
        name: "方法论设计",
        task: [
          "基于选题评估，为该研究设计方法论：研究范式选择及理由、具体方法、数据来源、可行性风险、伦理考量。",
          "选题评估：\n{{topic_evaluation}}",
          "只输出方法论设计。",
        ].join("\n"),
        output: "methodology",
        dependsOn: ["topic_eval"],
      },
      {
        id: "literature",
        type: "task",
        assigneeSlug: "academic-historian",
        name: "文献综述框架",
        task: [
          "基于选题评估，为该研究搭建文献综述骨架：主要文献脉络、代表性流派或争论、本研究在其中的位置。",
          "选题评估：\n{{topic_evaluation}}",
          "只输出文献综述框架。",
        ].join("\n"),
        output: "literature_frame",
        dependsOn: ["topic_eval"],
      },
      {
        id: "outline",
        type: "task",
        assigneeSlug: "academic-study-planner",
        name: "完整大纲",
        task: [
          "整合以上产出，给出论文完整章节大纲（到二级标题），每章一句话说明要解决什么。",
          "方法论：\n{{methodology}}",
          "文献框架：\n{{literature_frame}}",
          "只输出大纲。",
        ].join("\n"),
        output: "paper_outline",
        dependsOn: ["methodology", "literature"],
      },
    ],
    requiredExperts: ["academic-study-planner", "academic-historian"],
  },
];

export function getTeamWorkflowTemplate(
  templateId: string,
): TeamWorkflowTemplate | null {
  return (
    TEAM_WORKFLOW_TEMPLATES.find((template) => template.id === templateId) ??
    null
  );
}
