import {html, render} from '/node_modules/lit-html/lib/lit-extended.js';
import {repeat} from '../../lit-repeater.js';
import {Sample as BaseSample} from '../../../../examples/basic-repeat/basic-repeat.js';

export class Sample extends BaseSample {
    render() {
        if (!this.template) {
            this.template = (item, idx) => html`
                <li on-click=${() => console.log(item)}>${idx}: ${item}</li>
            `;
        }
        const {first, num, items} = this.state;
        const {template} = this;
        render(html`
            <ul>
                ${repeat(items, template, {first, num})}
            </ul>
        `, document.body);
    }
}