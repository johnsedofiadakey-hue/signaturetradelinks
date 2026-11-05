import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedUses,findProducts,minorBudget,rememberSlug,whatsappUrl} from '../src/discovery/model.js';

test('finder separates confirmed matches from missing details and rejects known mismatches',()=>{
 const rows=[
  {slug:'match',categorySlug:'tv',availability:'in_stock',price:{amountMinor:200000,currency:'GHS'},useCases:['gaming']},
  {slug:'incomplete',categorySlug:'tv',price:null},
  {slug:'too-expensive',categorySlug:'tv',price:{amountMinor:500000,currency:'GHS'},useCases:['gaming']},
  {slug:'wrong-use',categorySlug:'tv',price:{amountMinor:100000,currency:'GHS'},useCases:['movies']},
  {slug:'wrong-currency',categorySlug:'tv',price:{amountMinor:100,currency:'USD'},useCases:['gaming']},
  {slug:'unavailable',categorySlug:'tv',availability:'out_of_stock',price:{amountMinor:10000,currency:'GHS'},useCases:['gaming']},
 ];
 const result=findProducts(rows,{}, {category:'tv',budget:'2500',currency:'GHS',use:'gaming'});
 assert.deepEqual(result.matches.map(p=>p.slug),['match']);assert.deepEqual(result.incomplete.map(p=>p.slug),['incomplete']);
});

test('suitability needs explicit metadata; a suggestive title or negative text is not enough',()=>{
 assert.deepEqual(confirmedUses({name:'Gaming television'},{}),[]);
 assert.deepEqual(confirmedUses({}, {specifications:[{label:'Recommended use',value:'Gaming, Films'}]}),['gaming','movies']);
 assert.deepEqual(confirmedUses({}, {specifications:[{label:'Suitable for',value:'Not recommended for gaming'}]}),[]);
});

test('budget uses the currency precision and blank does not become a zero-budget claim',()=>{
 assert.equal(minorBudget('25.25','GHS'),2525);assert.equal(minorBudget('25','JPY'),25);
 for(const value of ['', '-1', '0', 'abc', 'Infinity'])assert.equal(minorBudget(value,'GHS'),null);
});

test('recent history deduplicates, moves a revisit to the front and retains only eight slugs',()=>{
 assert.deepEqual(rememberSlug(['a','b'],'b'),['b','a']);assert.equal(rememberSlug(Array.from({length:8},(_,i)=>String(i)),'new').length,8);
 assert.deepEqual(rememberSlug(['a'],null),['a']);
});

test('WhatsApp prepares an encoded product draft for a validated business number',()=>{
 const url=whatsappUrl('+233 54 932 9735',{slug:'test-tv',name:'TV & sound'},'https://example.test');
 assert.match(url,/^https:\/\/wa.me\/233549329735\?text=/);const text=new URL(url).searchParams.get('text');
 assert.ok(text.includes('TV & sound'));assert.ok(text.includes('https://example.test/p/test-tv'));
 assert.equal(whatsappUrl('invalid',{slug:'x',name:'x'},'https://example.test'),null);
});
