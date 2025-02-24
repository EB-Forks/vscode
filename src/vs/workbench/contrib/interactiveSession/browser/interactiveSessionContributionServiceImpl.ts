/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import * as resources from 'vs/base/common/resources';
import { localize } from 'vs/nls';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IRelaxedExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Registry } from 'vs/platform/registry/common/platform';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from 'vs/workbench/common/views';
import { getClearAction, getOpenInteractiveSessionEditorAction } from 'vs/workbench/contrib/interactiveSession/browser/interactiveSessionActions';
import { IInteractiveSessionViewOptions, INTERACTIVE_SIDEBAR_PANEL_ID, InteractiveSessionViewPane } from 'vs/workbench/contrib/interactiveSession/browser/interactiveSessionSidebar';
import { IInteractiveSessionContributionService, IInteractiveSessionProviderContribution } from 'vs/workbench/contrib/interactiveSession/common/interactiveSessionContributionService';
import * as extensionsRegistry from 'vs/workbench/services/extensions/common/extensionsRegistry';

const interactiveSessionExtensionPoint = extensionsRegistry.ExtensionsRegistry.registerExtensionPoint<IInteractiveSessionProviderContribution[]>({
	extensionPoint: 'interactiveSession',
	jsonSchema: {
		description: localize('vscode.extension.contributes.interactiveSession', 'Contributes an Interactive Session provider'),
		type: 'array',
		items: {
			additionalProperties: false,
			type: 'object',
			defaultSnippets: [{ body: { id: '', program: '', runtime: '' } }],
			properties: {
				id: {
					description: localize('vscode.extension.contributes.interactiveSession.id', "Unique identifier for this Interactive Session provider."),
					type: 'string'
				},
				label: {
					description: localize('vscode.extension.contributes.interactiveSession.label', "Display name for this Interactive Session provider."),
					type: 'string'
				},
				icon: {
					description: localize('vscode.extension.contributes.interactiveSession.icon', "An icon for this Interactive Session provider."),
					type: 'string'
				},
				when: {
					description: localize('vscode.extension.contributes.interactiveSession.when', "A condition which must be true to enable this Interactive Session provider."),
					type: 'string'
				},
			}
		}
	},
	activationEventsGenerator: (contributions: IInteractiveSessionProviderContribution[], result: { push(item: string): void }) => {
		for (const contrib of contributions) {
			result.push(`onInteractiveSession:${contrib.id}`);
		}
	},
});

export class InteractiveSessionContributionService implements IInteractiveSessionContributionService {
	declare _serviceBrand: undefined;

	private _registrationDisposables = new Map<string, IDisposable>();
	private _registeredProviders = new Map<string, IInteractiveSessionProviderContribution>();

	constructor() {
		interactiveSessionExtensionPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				const extensionDisposable = new DisposableStore();
				for (const providerDescriptor of extension.value) {
					this.registerInteractiveSessionProvider(extension.description, providerDescriptor);
					this._registeredProviders.set(providerDescriptor.id, providerDescriptor);
				}
				this._registrationDisposables.set(extension.description.identifier.value, extensionDisposable);
			}

			for (const extension of delta.removed) {
				const registration = this._registrationDisposables.get(extension.description.identifier.value);
				if (registration) {
					registration.dispose();
					this._registrationDisposables.delete(extension.description.identifier.value);
				}

				for (const providerDescriptor of extension.value) {
					this._registeredProviders.delete(providerDescriptor.id);
				}
			}
		});
	}

	public get registeredProviders(): IInteractiveSessionProviderContribution[] {
		return Array.from(this._registeredProviders.values());
	}

	private registerInteractiveSessionProvider(extension: Readonly<IRelaxedExtensionDescription>, providerDescriptor: IInteractiveSessionProviderContribution): IDisposable {
		// Register View Container
		const viewContainerId = INTERACTIVE_SIDEBAR_PANEL_ID + '.' + providerDescriptor.id;
		const viewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
			id: viewContainerId,
			title: providerDescriptor.label,
			icon: providerDescriptor.icon !== '' ? resources.joinPath(extension.extensionLocation, providerDescriptor.icon) : Codicon.commentDiscussion,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [viewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
			storageId: viewContainerId,
			hideIfEmpty: true,
			order: 100,
		}, ViewContainerLocation.Sidebar);

		// Register View
		const viewId = InteractiveSessionViewPane.ID + '.' + providerDescriptor.id;
		const viewDescriptor: IViewDescriptor[] = [{
			id: viewId,
			name: providerDescriptor.label,
			canToggleVisibility: false,
			canMoveView: true,
			ctorDescriptor: new SyncDescriptor(InteractiveSessionViewPane, [<IInteractiveSessionViewOptions>{ providerId: providerDescriptor.id }]),
			when: ContextKeyExpr.deserialize(providerDescriptor.when),
		}];
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(viewDescriptor, viewContainer);

		// Clear action in view title
		const clearAction = registerAction2(getClearAction(viewId, providerDescriptor.id));

		// "Open Interactive Session Editor" Action
		const openEditor = registerAction2(getOpenInteractiveSessionEditorAction(providerDescriptor.id, providerDescriptor.label, providerDescriptor.when));

		return {
			dispose: () => {
				Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).deregisterViews(viewDescriptor, viewContainer);
				Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).deregisterViewContainer(viewContainer);
				clearAction.dispose();
				openEditor.dispose();
			}
		};
	}
}
