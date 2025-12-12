import * as React from 'react';
import { VSCodeButton, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import './search-widget.css';

interface ISearchWidgetProps {
    onSearch: (text: string) => void;
    onClose: () => void;
    onNext: () => void;
    onPrevious: () => void;
    visible: boolean;
    resultCount: number;
    currentResultIndex: number;
}

interface ISearchWidgetState {
    searchText: string;
}

export class SearchWidget extends React.Component<ISearchWidgetProps, ISearchWidgetState> {
    private inputRef = React.createRef<any>();

    constructor(props: ISearchWidgetProps) {
        super(props);
        this.state = {
            searchText: ''
        };
    }

    componentDidUpdate(prevProps: ISearchWidgetProps) {
        if (this.props.visible && !prevProps.visible) {
            setTimeout(() => {
                if (this.inputRef.current) {
                    this.inputRef.current.focus();
                }
            }, 100);
        }
    }

    private onInput(e: any) {
        this.setState({ searchText: e.target.value });
    }

    private onKeyDown(e: any) {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                this.props.onPrevious();
            } else {
                this.props.onSearch(this.state.searchText);
            }
        } else if (e.key === 'Escape') {
            this.props.onClose();
        }
    }

    render() {
        if (!this.props.visible) {
            return null;
        }

        let infoText = '';
        if (this.props.resultCount > 0) {
            infoText = `${this.props.currentResultIndex + 1} of ${this.props.resultCount}`;
        } else if (this.state.searchText && this.props.resultCount === 0) {
            infoText = 'No results';
        }

        return (
            <div className="search-widget">
                <div className="search-widget-input-container">
                    <VSCodeTextField
                        ref={this.inputRef}
                        value={this.state.searchText}
                        onInput={this.onInput.bind(this)}
                        onKeyDown={this.onKeyDown.bind(this)}
                        placeholder="Find Hex Value (e.g. FF 0A)"
                        className="search-input"
                    >
                    </VSCodeTextField>
                </div>
                
                {infoText && <div className="search-info">{infoText}</div>}

                <div className="search-widget-actions">
                    <VSCodeButton appearance="icon" onClick={this.props.onPrevious} title="Previous Match" disabled={this.props.resultCount === 0}>
                        <span className="codicon codicon-arrow-up"></span>
                    </VSCodeButton>
                    <VSCodeButton appearance="icon" onClick={this.props.onNext} title="Next Match" disabled={this.props.resultCount === 0}>
                        <span className="codicon codicon-arrow-down"></span>
                    </VSCodeButton>
                    <VSCodeButton appearance="icon" onClick={this.props.onClose} title="Close">
                        <span className="codicon codicon-close"></span>
                    </VSCodeButton>
                </div>
            </div>
        );
    }
}
