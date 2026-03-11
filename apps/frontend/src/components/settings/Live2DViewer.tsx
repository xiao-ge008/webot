import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as PIXI from 'pixi.js';
import type { Live2dModelConfig } from '@/main/types';

// Important for pixi-live2d-display
(window as any).PIXI = PIXI;

type Live2DModelClass = typeof import('pixi-live2d-display').Live2DModel;
type Live2DModelInstance = InstanceType<Live2DModelClass>;

const hasLive2dRuntime = () => {
    const globalWindow = window as Window & {
        Live2D?: unknown;
        Live2DCubismCore?: unknown;
    };
    return Boolean(globalWindow.Live2D || globalWindow.Live2DCubismCore);
};

interface Live2DViewerProps {
    modelConfig: Live2dModelConfig | null;
    currentMotion?: string; // The motion file path to play
    currentExpression?: string; // The expression file path to play
}

export function Live2DViewer({ modelConfig, currentMotion, currentExpression }: Live2DViewerProps) {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModelInstance | null>(null);
    const live2dModelRef = useRef<Live2DModelClass | null>(null);
    const [runtimeError, setRuntimeError] = useState<string | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        // Initialize PIXI Application
        const app = new PIXI.Application({
            view: canvasRef.current,
            autoStart: true,
            backgroundAlpha: 0,
            resizeTo: canvasRef.current.parentElement || window,
        });

        appRef.current = app;

        return () => {
            app.destroy(false, { children: true });
        };
    }, []);

    useEffect(() => {
        let canceled = false;

        const clearModel = () => {
            if (modelRef.current && appRef.current) {
                const currentModel = modelRef.current as unknown as PIXI.DisplayObject;
                appRef.current.stage.removeChild(currentModel);
                modelRef.current.destroy();
                modelRef.current = null;
            }
        };

        const ensureLive2dModel = async () => {
            if (live2dModelRef.current) return live2dModelRef.current;
            const module = await import('pixi-live2d-display');
            live2dModelRef.current = module.Live2DModel;
            return module.Live2DModel;
        };

        const loadModel = async () => {
            if (!modelConfig || !appRef.current) {
                clearModel();
                setRuntimeError(null);
                return;
            }

            try {
                clearModel();

                if (!hasLive2dRuntime()) {
                    setRuntimeError(t('settings.live2dViewer.runtimeMissing'));
                    return;
                }

                setRuntimeError(null);

                // Electron 内部模型协议
                const modelUrl = `webot-model://${modelConfig.id}/${modelConfig.modelJsonFile}`;

                const Live2DModel = await ensureLive2dModel();
                const model = await Live2DModel.from(modelUrl, {
                    autoUpdate: true,
                    autoInteract: true,
                });

                modelRef.current = model;

                if (appRef.current) {
                    appRef.current.stage.addChild(model as unknown as PIXI.DisplayObject);

                    // Fit the model to the canvas
                    const scaleX = appRef.current.view.width / model.width;
                    const scaleY = appRef.current.view.height / model.height;
                    const scale = Math.min(scaleX, scaleY) * 0.9;

                    model.scale.set(scale);
                    model.anchor.set(0.5, 0.5);
                    model.x = appRef.current.view.width / 2;
                    model.y = appRef.current.view.height / 2;
                }
            } catch (error) {
                if (!canceled) {
                    setRuntimeError(t('settings.live2dViewer.loadFailed'));
                }
                console.error('Failed to load Live2D model in preview:', error);
            }
        };

        loadModel();

        return () => {
            canceled = true;
        };
    }, [modelConfig, t]);

    useEffect(() => {
        if (modelRef.current && currentMotion) {
            try {
                // Find group from motion string (e.g. motions/8.mtn)
                const motionConfig = modelConfig?.motions.find(m => m.file === currentMotion);
                if (motionConfig) {
                    const motionIndex = Number.parseInt(motionConfig.name, 10);
                    modelRef.current.motion(
                        motionConfig.group,
                        Number.isNaN(motionIndex) ? 0 : motionIndex,
                        3,
                    );
                } else {
                    // Try to guess
                    const group = "Tap"; // default 
                    modelRef.current.motion(group, 0, 3);
                }
            } catch (e) {
                console.error("Play motion error:", e);
            }
        }
    }, [currentMotion, modelConfig]);

    useEffect(() => {
        if (modelRef.current && currentExpression) {
            try {
                const exprConfig = modelConfig?.expressions.find(e => e.file === currentExpression);
                if (exprConfig) {
                    const exprIndex = Number.parseInt(exprConfig.name, 10);
                    modelRef.current.expression(Number.isNaN(exprIndex) ? exprConfig.name : exprIndex);
                }
            } catch (e) {
                console.error("Play expression error:", e);
            }
        }
    }, [currentExpression, modelConfig]);

    return (
        <div className="w-full h-full flex items-center justify-center relative pointer-events-auto">
            <canvas ref={canvasRef} className="w-full h-full outline-none" tabIndex={0} />
            {!modelConfig && !runtimeError && (
                <div className="absolute text-foreground-tertiary text-sm">
                    {t('settings.live2dViewer.noPreview')}
                </div>
            )}
            {runtimeError && (
                <div className="absolute text-foreground-tertiary text-sm text-center px-4">
                    {runtimeError}
                </div>
            )}
        </div>
    );
}
