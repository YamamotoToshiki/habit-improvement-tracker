const translations = {
    ja: {
        appTitle: "習慣改善トラッカー",
        nav: {
            settings: "実験設定",
            record: "日次記録",
            results: "結果表示",
            library: "介入策一覧",
            logout: "ログアウト"
        },
        loading: "読み込み中...",
        login: {
            title: "習慣改善トラッカー",
            description: "行動科学に基づいた習慣形成支援アプリ",
            googleButton: "Googleでログイン",
            errors: {
                popupClosed: "ログインがキャンセルされました。",
                networkError: "ネットワークエラーが発生しました。",
                generic: "ログインに失敗しました。"
            }
        },
        settings: {
            title: "実験設定",
            labels: {
                strategy: "介入策選択",
                strategyCustom: "介入策入力（その他選択時）",
                action: "介入策の詳細",
                duration: "実験期間（日）",
                notification: "通知時刻"
            },
            placeholders: {
                strategyCustom: "最大50文字",
                action: "最大2,000文字"
            },
            tooltips: {
                strategyCustom: "最大50文字",
                duration: "1から90までの数値を入力してください（推奨期間：14日～28日）",
                endExperiment: "現在の実験を早期終了します"
            },
            options: {
                strategies: [
                    "環境の整備",
                    "開始コストの低下",
                    "予めの意思決定",
                    "即時報酬の導入",
                    "自己イメージの形成",
                    "（その他）"
                ]
            },
            buttons: {
                save: "保存",
                end: "実験終了"
            },
            messages: {
                saveConfirm: "実験設定を保存しますか？",
                saveSuccess: "実験設定を保存しました。",
                endConfirm: "現在の実験を終了しますか？この操作は取り消せません。",
                endSuccess: "実験を終了しました。",
                validation: {
                    required: "必須項目を入力してください。",
                    maxLength: "文字以内で入力してください。"
                }
            }
        },
        record: {
            title: "日次記録",
            info: {
                experiment: "実験名",
                daysElapsed: "経過日数",
                date: "日付",
                noExperiment: "実験が設定されていません"
            },
            labels: {
                carriedOut: "作業実施可否",
                startedTime: "作業開始時間帯",
                durationTime: "作業継続時間",
                interrupted: "中断の有無",
                interruptionReason: "中断の主な理由",
                concentration: "集中度 (1-5)",
                accomplishment: "達成感 (1-5)",
                fatigue: "疲労感 (1-5)",
                memo: "メモ"
            },
            options: {
                timeOfDay: {
                    lateNight: "深夜 (0:00-2:59)",
                    earlyMorning: "早朝 (3:00-5:59)",
                    morning: "朝 (6:00-8:59)",
                    daytime: "昼 (9:00-14:59)",
                    evening: "夕方 (15:00-17:59)",
                    night: "夜 (18:00-23:59)"
                },
                duration: {
                    min5: "5分",
                    min15: "15分",
                    min30: "30分",
                    hour1: "1時間",
                    hour3: "3時間"
                }
            },
            placeholders: {
                interruptionReason: "最大50文字",
                memo: "最大2,000文字"
            },
            buttons: {
                save: "保存",
                edit: "修正"
            },
            messages: {
                saveConfirm: "日次記録を保存しますか？",
                saveSuccess: "日次記録を保存しました。",
                noExperiment: "現在進行中の実験がありません。実験設定画面から新しい実験を開始してください。"
            }
        },
        results: {
            title: "結果表示",
            labels: {
                experimentSelect: "実験選択",
                strategy: "介入策",
                action: "行動",
                period: "期間",
                rate: "記録率",
                status: "状態"
            },
            graphs: {
                graph1: "グラフ1：集計期間全体の作業実施率",
                graph2: "グラフ2：日付ごとの作業継続時間の推移",
                graph3: "グラフ3：作業開始時間帯・中断率・集中度の相関",
                graph4: "グラフ4：作業開始時間帯・中断率・達成感の相関",
                graph5: "グラフ5：作業開始時間帯・中断率・疲労感の相関",
                labels: {
                    carriedOut: "作業実施済",
                    notCarriedOut: "作業非実施",
                    interruptionRate: "中断率",
                    concentration: "集中度",
                    accomplishment: "達成感",
                    fatigue: "疲労感"
                },
                warnings: {
                    lowSample: "サンプル数が少ないため参考値です"
                }
            },
            calendar: {
                noRecord: "この日の記録はありません"
            },
            buttons: {
                export: "データエクスポート",
                close: "閉じる"
            }
        },
        library: {
            title: "介入策一覧",
            items: {
                environment: {
                    title: "環境の整備",
                    content: "望ましい行動を取りやすく、望ましくない行動を取りにくくするように環境を調整する方法です。たとえば、「帰宅後すぐに作業用シャツに着替える」「机とベッドを視覚的に分離する」「作業専用のライトを使用する」などによって、作業空間と休息空間を明確に区別します。"
                },
                startCost: {
                    title: "開始コストの低下",
                    content: "行動を始める際のハードルを下げて、最初の一歩を踏み出しやすくする方法です。たとえば、「まず2分だけ机に向かう」「まず1ページだけ本を読む」といった小さな単位に作業を分割したり、エディタを自動で開くように設定して準備の手間を省いたりします。"
                },
                decision: {
                    title: "予めの意思決定",
                    content: "行動を実施するタイミングと具体的な内容を事前に決めておく方法です。たとえば、「もし午前6時に目覚めたら、アラーム停止→顔を洗う→着替える」のようなif-thenルールを紙に書いて貼ったり、カレンダーに具体的な予定を入れたりすることで、その場での判断を不要にします。"
                },
                reward: {
                    title: "即時報酬の導入",
                    content: "行動の直後に自分にとって心地よい報酬を与えることで、継続のモチベーションを高める方法です。たとえば、「25分の作業を完遂でコーヒーを1杯飲む」「集中セッション後に横になる休憩を許可する」など、達成感や満足感を行動と結びつけます。"
                },
                selfImage: {
                    title: "自己イメージの形成",
                    content: "自分が目指す姿を言語化し、その人物像に基づいて行動を選択する方法です。たとえば、「私は〇〇を達成する人である」といった宣言を壁に貼ったり、「今日の作業の完了後に幸せな気分になっている」といった一時的なメモを書いたりすることで、理想の自分を具体化します。"
                },
                other: {
                    title: "（その他）",
                    content: "独自に定義した介入策を試行することができます。たとえば、「可変的報酬の導入」（作業の実施回数や継続時間をポイントとして貯蓄し、そのポイントを消費することで大きな報酬を自分に許可する）といった介入策を推奨します。また、「何もしない」と設定して、他の介入策の対照実験を行うために使用することもできます。"
                }
            }
        },
        common: {
            unit: {
                day: "日",
                minute: "分",
                times: "回"
            },
            error: "エラーが発生しました。",
            close: "閉じる"
        }
    },
    en: {
        // Future implementation
    }
};
