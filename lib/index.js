// dsh-ralph-command — host 半边：原生斜杠命令 `/ralph`
//
// 官方 `ralph` 工具（@deepseek-ai/dsh-tool-ralph）默认 disabled，且工具描述把
// 调用权钉死在「直接人类明确要求 Ralph 式 fresh-agent 迭代」上。本插件不碰
// 工具本身（那是 profile patch 里 `- id: tool-ralph / disabled: false` 的事），
// 只把「点名」变成一条可以一次打完的斜杠命令：
//
//   /ralph 把 ssq-scrape 补齐测试并让 CI 全绿，最多 20 轮
//
// handler 把输入装配成一条**用户身份**的消息（source.kind = "user"，与官方
// command-goal 的 submitObjectiveAttachments 同构），经 agent.followup() 投进
// 「下一轮」收件箱并唤醒驱动器。于是模型看到的和你亲手打那句点名话术完全等价
// ——工具描述的调用闸自然放行，没有任何越权路径。
//
// 命令面的返回值只用于在模型历史之外渲染一条结算回执（命令事件不进轮次），
// 真正的执行发生在随后被唤醒的那一轮里。
//
// 回滚：profile patch 删掉 insert 块 + package.json 依赖行 + 重启应用。

import { randomUUID } from "node:crypto";

export const name = "dsh-ralph-command";

/**
 * `commands` 必须显式声明：cordis 对未注入的服务访问会直接抛
 * `cannot get property "commands" without inject`。
 */
export const inject = ["commands"];

const COMMAND_NAME = "ralph";

const USAGE = [
	"用法：/ralph <一句话总目标> [最多 N 轮]",
	"示例：/ralph 把 ssq-scrape 补齐测试并让 CI 全绿，最多 20 轮",
	"说明：目标在整轮循环中不可变；完成判定是子 agent 自报，结束后值得抽查产出。",
].join("\n");

/** 解析命令输入：目标必填，轮数可选（`最多 N 轮` / `max N rounds`）。 */
function parseInput(raw) {
	const text = String(raw ?? "").trim();
	if (text === "") return { ok: false, reason: USAGE };
	const roundsMatch = text.match(/(?:最多|至多|不超过)\s*(\d{1,3})\s*轮|(?:max|maximum)\s+(\d{1,3})\s+rounds/i);
	const rounds = roundsMatch ? Number(roundsMatch[1] ?? roundsMatch[2]) : undefined;
	return { ok: true, objective: text, rounds: rounds && rounds > 0 ? rounds : undefined };
}

/** 组装点名话术：与用户手打等价，模型侧的工具描述闸据此放行。 */
function buildPrompt(objective, rounds) {
	const lines = [
		"Use the ralph tool for the following objective, in a Ralph-style fresh-agent loop:",
		"",
		objective,
	];
	if (rounds) lines.push("", `Round limit: ${rounds}.`);
	return lines.join("\n");
}

export function apply(ctx) {
	const dispose = ctx.commands.register({
		name: COMMAND_NAME,
		description: "Ralph Loop：把目标交给一串每轮全新上下文的 fresh agent 迭代（官方 tool-ralph）",
		input: { hint: "<一句话总目标> [最多 N 轮]" },
		handler: ({ agent, rawInput }) => {
			const parsed = parseInput(rawInput);
			if (!parsed.ok) return { kind: "error", text: parsed.reason };

			// 消息形状内联（与 dsh-memguard 已验证的插话范式一致，零宿主包依赖）：
			// id + role:"user" + content + source，交给 agent.followup()。
			const message = {
				id: randomUUID(),
				role: "user",
				content: [{ type: "text", text: buildPrompt(parsed.objective, parsed.rounds) }],
				source: { kind: "user" },
			};
			agent.followup(message);

			const roundNote = parsed.rounds ? `，上限 ${parsed.rounds} 轮` : "";
			return {
				kind: "success",
				text: `Ralph loop 已提交（下一轮启动）${roundNote}：${parsed.objective}`,
			};
		},
	});

	if (typeof dispose === "function") ctx.effect(() => dispose, "dsh-ralph-command: command dispose");
	console.log(`[dsh-ralph-command] command /${COMMAND_NAME} registered`);
}
