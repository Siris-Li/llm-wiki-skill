import React from "react";
import { MessageSquarePlus, Send } from "lucide-react";
import type { GraphSummaryCommand, SelectionAction } from "@llm-wiki/graph-engine";

import type { GraphGroupDrawerViewModel } from "../lib/graph-group-drawer";

interface GraphGroupDrawerProps {
	testId: "graph-community-summary" | "graph-selection-drawer";
	view: GraphGroupDrawerViewModel;
	freeText: string;
	enterCommand?: GraphSummaryCommand | null;
	nodeSectionTitle: string;
	onFreeTextChange: (value: string) => void;
	onAsk: (action: SelectionAction | null) => void;
	onAskInNewConversation: (action: SelectionAction | null) => void;
	onCommand?: (command: GraphSummaryCommand) => void;
	onShowNodeSummary?: (nodeId: string) => void;
	onPreviewNode?: (nodeId: string | null) => void;
}

export function GraphGroupDrawer({
	testId,
	view,
	freeText,
	enterCommand,
	nodeSectionTitle,
	onFreeTextChange,
	onAsk,
	onAskInNewConversation,
	onCommand,
	onShowNodeSummary,
	onPreviewNode,
}: GraphGroupDrawerProps) {
	const canSendFreeText = freeText.trim().length > 0;
	return (
		<React.Fragment>
			<article className="graph-group-drawer" data-group-drawer="true" data-testid={testId}>
			<div className="graph-group-overview">
				<div className="graph-group-overview-main">
					<div className="graph-summary-kicker">{view.kicker}</div>
					<h2 className="graph-summary-title">{view.title}</h2>
					{view.description && <p className="graph-summary-excerpt">{view.description}</p>}
					<div className="graph-summary-facts">
						{view.facts.map((fact) => (
							<div className="graph-summary-fact" key={fact.label}>
								<strong>{fact.value}</strong>
								<span>{fact.label}</span>
							</div>
						))}
					</div>
					{view.tags.length > 0 && (
						<div className="graph-group-tags">
							{view.tags.map((tag) => (
								<span key={tag} className="graph-summary-community-chip">{tag}</span>
							))}
						</div>
					)}
				</div>
				{enterCommand && (
					<button
						type="button"
						className="graph-group-enter"
						onClick={() => onCommand?.(enterCommand)}
					>
						{enterCommand.label}
					</button>
				)}
			</div>
			<div className="graph-group-action-grid">
				{view.actions.map((action) => (
					<button
						key={action.id}
						type="button"
						className="graph-group-action"
						data-recommended={action.recommended ? "true" : "false"}
						data-group-drawer="action"
						onClick={() => onAsk(action)}
					>
						{action.label}
					</button>
				))}
			</div>
			<section className="graph-summary-section">
				<h3>{nodeSectionTitle}</h3>
				{view.nodes.length === 0 ? (
					<div className="graph-summary-muted">暂无节点</div>
				) : (
					<ul className="graph-group-node-list">
						{view.nodes.map((node) => (
							<li key={node.nodeId}>
								<button
									type="button"
									className="graph-group-node"
									onMouseEnter={() => onPreviewNode?.(node.nodeId)}
									onMouseLeave={() => onPreviewNode?.(null)}
									onFocus={() => onPreviewNode?.(node.nodeId)}
									onBlur={() => onPreviewNode?.(null)}
									onClick={() => onShowNodeSummary?.(node.nodeId)}
								>
									<span>{node.label}</span>
									<small>{node.role}</small>
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
			<div className="graph-group-dialogue">
				<textarea
					className="graph-selection-textarea"
					value={freeText}
					onChange={(event) => onFreeTextChange(event.target.value)}
					rows={3}
					placeholder="补充说明（可选）"
				/>
				<div className="graph-selection-footer">
					<button
						type="button"
						className="graph-selection-send"
						data-group-drawer="send"
						onClick={() => onAsk(null)}
						disabled={!canSendFreeText}
					>
						<Send />
						发送
					</button>
					<button
						type="button"
						className="graph-selection-secondary"
						data-group-drawer="new-conversation"
						onClick={() => onAskInNewConversation(null)}
					>
						<MessageSquarePlus />
						新对话
					</button>
				</div>
			</div>
		</article>
		</React.Fragment>
	);
}
