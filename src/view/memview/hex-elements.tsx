/* eslint-disable @typescript-eslint/naming-convention */
import * as React from 'react';
import /* frozenState */ './webview-globals';
import /*
    RecoilRoot,
    atom,
    selector,
    useRecoilState,
    useRecoilValue,
    useSetRecoilState
    */
'recoil';
import { DualViewDoc, DummyByte, IDualViewDocGlobalEventArg } from './dual-view-doc';
import { IMemValue } from './shared';
import { hexFmt64 } from './utils';

export type OnCellChangeFunc = (address: bigint, val: number) => void;
interface IHexCell {
    address: bigint;
    byteInfo: IMemValue;
    onChange?: OnCellChangeFunc;
}

interface IHexCellState {
    frozen: boolean;
}
export class HexCellValue extends React.Component<IHexCell, IHexCellState> {
    private static currentDOMElt: HTMLSpanElement | undefined = undefined; // createRef not working on span element
    private static lastGoodValue = '';
    private static newGoodValue = '';

    constructor(public props: IHexCell) {
        super(props);
        /*
        const [frozen] = useRecoilState<boolean>(frozenState);
        */
        this.state = {
            frozen: false
        };
    }

    classNames = () => {
        return (
            'hex-cell hex-cell-value' +
            (this.state.frozen ? ' hex-cell-value-dirty' : '') +
            (this.props.byteInfo.orig !== this.props.byteInfo.cur ? ' hex-cell-value-changed' : '')
        );
    };

    onValueChanged = (val: string) => {
        val = val.trim().toLowerCase();
        while (val.startsWith('0x')) {
            val = val.substring(2);
        }
        while (val.length > 1 && val.startsWith('0')) {
            val = val.substring(1);
        }
        if (val.length > 2 || val.length === 0 || /[^0-9a-f]]/.test(val)) {
            return;
        }
        HexCellValue.lastGoodValue = val;
        const intVal = parseInt(val, 16);
        if (this.props.byteInfo.cur !== intVal) {
            this.props.byteInfo.cur = intVal;
            DualViewDoc.setCurrentDocByte(this.props.address, intVal);
            if (this.props.onChange) {
                this.props.onChange(this.props.address, intVal);
            }
        }
    };

    valueStr = () => {
        return this.props.byteInfo.cur >= 0
            ? hexValuesLookup[(this.props.byteInfo.cur >>> 0) & 0xff]
            : '~~';
    };

    editable = () => {
        return !this.state.frozen && !DualViewDoc.currentDoc?.isReadonly;
    };

    public onKeyDown(event: any) {
        if (!this.editable()) {
            event.preventDefault();
            return;
        }
        let v: string = HexCellValue.lastGoodValue;
        if (event.key === 'Enter' || event.key === 'Tab') {
            if (v === '') {
                HexCellValue.revertEditsInDOM(HexCellValue.currentDOMElt, this.valueStr());
                return;
            }
            v = HexCellValue.lastGoodValue;
        } else if (event.key !== 'Escape') {
            if (event.key.length === 1) {
                if (!/[0-9a-fA-f]/.test(event.key)) {
                    event.preventDefault();
                }
            }
            return;
        } else {
            HexCellValue.revertEditsInDOM(HexCellValue.currentDOMElt, this.valueStr());
            return;
        }
        if (v) {
            HexCellValue.newGoodValue = v;
            setTimeout(() => {
                this.onValueChanged(v);
            }, 1);
        }
    }
    private onKeyDownFunc = this.onKeyDown.bind(this);

    private static revertEditsInDOM(cell: HTMLSpanElement | undefined, val: string) {
        if (cell) {
            setTimeout(() => {
                cell.innerText = val;
            }, 1);
        }
    }

    private onInput(ev: any) {
        if (!this.editable()) {
            return;
        }
        // console.log('onInput: new value = ' + ev.currentTarget.innerText);
        if (ev.currentTarget.innerText.length > 2) {
            const el = ev.currentTarget;
            const val = HexCellValue.lastGoodValue;
            setTimeout(() => {
                el.innerText = val;
            }, 1);
        } else {
            HexCellValue.lastGoodValue = ev.currentTarget.innerText;
        }
    }
    private onInputFunc = this.onInput.bind(this);
    private onFocus(ev: any) {
        if (ev.currentTarget && this.editable()) {
            // console.log(`onFocus: new = ${ev.currentTarget.innerText}, old = ${this.valueStr()}`);
            HexCellValue.currentDOMElt = ev.currentTarget;
            try {
                HexCellValue.selectItem(ev.currentTarget);
            } catch {
                console.error('HexCellValue.selectItem failed');
            }
            document.addEventListener('keydown', this.onKeyDownFunc, false);
            HexCellValue.lastGoodValue = this.valueStr();
            HexCellValue.newGoodValue = '';
        }
    }
    private onFocusFunc = this.onFocus.bind(this);
    private onBlur(ev: any) {
        if (ev.currentTarget && this.editable()) {
            // console.log('onBlur: ' + ev.currentTarget.innerText);
            document.removeEventListener('keydown', this.onKeyDownFunc, false);
            HexCellValue.revertEditsInDOM(
                HexCellValue.currentDOMElt,
                HexCellValue.newGoodValue || this.valueStr()
            );
            HexCellValue.currentDOMElt = undefined;
            HexCellValue.newGoodValue = '';
        }
    }
    private onBlurFunc = this.onBlur.bind(this);

    static selectItem(item: any) {
        let range, selection: any;
        if (window.getSelection && document.createRange) {
            selection = window.getSelection();
            range = document.createRange();
            range.selectNodeContents(item);
            selection.removeAllRanges();
            selection.addRange(range);
        } else if ((document as any).selection && (document.body as any).createTextRange) {
            range = (document.body as any).createTextRange();
            range.moveToElementText(this);
            range.select();
        }
    }

    render() {
        return (
            <span
                tabIndex={0}
                suppressContentEditableWarning={true}
                contentEditable={true}
                className={this.classNames()}
                onFocus={this.onFocusFunc}
                onBlur={this.onBlurFunc}
                onInput={this.onInputFunc}
            >
                {this.valueStr()}
            </span>
        );
    }
}

export const HexCellAddress: React.FC<{ address: bigint }> = ({ address }) => {
    const classNames = 'hex-cell hex-cell-address';
    // const id = `hex-cell-address-${address}`;
    const valueStr = address.toString(16).padStart(16, '0').padEnd(18, ' ');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellChar: React.FunctionComponent<{
    _address: bigint;
    byteInfo: IMemValue;
}> = ({ _address, byteInfo }) => {
    // const id = `hex-cell-char-${address}`
    const val = byteInfo.cur;
    const origVal = byteInfo.orig;
    const valueStr = val >= 0 ? charCodesLookup[val] : '~~';
    const classNames = 'hex-cell hex-cell-char' + (val !== origVal ? ' hex-cell-char-changed' : '');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmpty: React.FunctionComponent<{
    length: number;
    fillChar?: string;
    cls?: string;
}> = ({ length = 1, fillChar = ' ', cls = '' }) => {
    const classNames = 'hex-cell ' + cls;
    const valueStr = fillChar.repeat(length);
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmptyHeader: React.FunctionComponent<{
    length?: number;
    fillChar?: string;
    cls?: string;
}> = ({ length = 1, fillChar = ' ', cls = '' }) => {
    const classNames = `hex-cell hex-cell-char-header ${cls}`;
    const valueStr = fillChar.repeat(length);
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellValueHeader: React.FunctionComponent<{
    value: number;
}> = ({ value }) => {
    const classNames = 'hex-cell hex-cell-value-header';
    // const id = `hex-cell-value-header-${value}`;
    const valueStr = hexValuesLookup[(value >>> 0) & 0xff];
    return <span className={classNames}>{valueStr}</span>;
};

export interface IHexHeaderRow {
    style?: any;
}

export function HexHeaderRow(_props: IHexHeaderRow): JSX.Element {
    const classNames = 'hex-header-row';
    const ary = [];
    for (let x = 0; x < 16; x++) {
        ary.push(x);
    }
    const decodedText = 'Decoded Bytes'.padEnd(16, ' ').split('');
    return (
        <div className={classNames}>
            <HexCellEmptyHeader
                key={1}
                length={18}
                fillChar='.'
                cls='hex-cell-address hex-cell-invisible'
            />
            {ary.map((v, i) => {
                return <HexCellValueHeader key={i + 2} value={v} />;
            })}
            <HexCellEmpty key={100} length={1} fillChar='.' cls='hex-cell-invisible' />
            {decodedText.map((v, i) => {
                return <HexCellEmptyHeader key={i + 18} fillChar={v} />;
            })}
        </div>
    );
}

export interface IHexDataRow {
    address: bigint;
    onChange?: OnCellChangeFunc;
    style?: any;
    cls?: string;
}

interface IHexDataRowState {
    bytes: IMemValue[];
}

export class HexDataRow extends React.Component<IHexDataRow, IHexDataRowState> {
    private sessionId = 'unknown';
    private sessionStatus = 'unknown';
    private onRowChangeFunc = this.rowChanged.bind(this);
    private mountStatus = false;
    constructor(public props: IHexDataRow) {
        super(props);
        const bytes = [];
        for (let ix = 0; ix < 16; ix++) {
            bytes[ix] = DummyByte;
        }
        this.state = {
            bytes: bytes
        };
    }

    private async rowChanged(address: bigint, newVal: number) {
        await this.getBytes();
        if (this.props.onChange) {
            this.props.onChange(address, newVal);
        }
    }

    private async getBytes() {
        await DualViewDoc.getCurrentDocByte(this.props.address);
        // Since we are async, we can get unmounted while we wait
        if (this.mountStatus) {
            // Get the first byte of the row. The rest should be in the same page
            // so do it the fast way, since the bytes should have been loaded by now
            const ret = DualViewDoc.getRowUnsafe(this.props.address);
            this.setState({ bytes: ret });
        }
    }

    async componentDidMount() {
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEventFunc);
        this.mountStatus = true;
        await this.getBytes();
    }

    componentWillUnmount() {
        DualViewDoc.globalEventEmitter.removeListener('any', this.onGlobalEventFunc);
        // console.log(`In HexDataRow.componentWillUnmount() ${this.props.address}`);
        this.mountStatus = false;
    }

    private onGlobalEventFunc = this.onGlobalEvent.bind(this);
    private onGlobalEvent(arg: IDualViewDocGlobalEventArg) {
        // console.log(`In HexDataRow.onGlobalEvent() ${hexFmt64(this.props.address)}`);
        let modified = false;
        if (arg.sessionId !== this.sessionId) {
            this.sessionId = arg.sessionId || this.sessionId;
            modified = true;
        }
        if (arg.sessionStatus !== this.sessionStatus) {
            this.sessionStatus = arg.sessionStatus || this.sessionStatus;
            modified = true;
        }
        if (modified) {
            this.getBytes(); // TODO: Is this safe to do right now? SHould we wait? how?
        }
    }

    render() {
        // console.log(`In HexDataRow.render() ${this.props.address}`);
        const classNames = 'hex-data-row ' + (this.props.cls || '');
        const values = [];
        const chars = [];
        for (let ix = 0; ix < 16; ix++) {
            const addr = this.props.address + BigInt(ix);
            values.push(
                <HexCellValue
                    key={ix + 2}
                    address={addr}
                    byteInfo={this.state.bytes[ix]}
                    onChange={this.onRowChangeFunc}
                />
            );
            chars.push(
                <HexCellChar _address={addr} byteInfo={this.state.bytes[ix]} key={ix + 18} />
            );
        }
        const gap = <HexCellEmpty length={1} fillChar='.' cls='hex-cell-invisible'></HexCellEmpty>;
        return (
            <div className={classNames} style={this.props.style || ''}>
                <HexCellAddress key={1} address={this.props.address} />
                <div>
                    {values}
                    {gap}
                    {chars}
                </div>
            </div>
        );
    }
}
export interface IHexCellEditProps {
    trigger: boolean;
    clientX: number;
    clientY: number;
    value: string;
    callback: (value: string | undefined) => void;
}
export interface IHexCellEditState {
    isOpen: boolean;
    value: string;
}

const odStyleChars = [
    'nul',
    'soh',
    'stx',
    'etx',
    'eot',
    'enq',
    'ack',
    'bel',
    'bs',
    'ht',
    'nl',
    'vt',
    'ff',
    'cr',
    'so',
    'si',
    'dle',
    'dc1',
    'dc2',
    'dc3',
    'dc4',
    'nak',
    'syn',
    'etb',
    'can',
    'em',
    'sub',
    'esc',
    'fs',
    'gs',
    'rs',
    'us',
    'sp'
];

const charCodesLookup: string[] = [];
const hexValuesLookup: string[] = [];
for (let byte = 0; byte <= 255; byte++) {
    const v =
        byte <= 32
            ? odStyleChars[byte]
            : byte === 127
            ? 'del'
            : byte > 127 && byte <= 159
            ? '.'
            : String.fromCharCode(byte);
    charCodesLookup.push(v);
    hexValuesLookup.push(byte.toString(16).padStart(2, '0'));
}

/*
function bigIntMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function bigIntMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}
*/
