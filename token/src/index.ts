import { nat64, Record, update, ic, StableBTreeMap, Vec, Canister, text, bool, query, Opt } from 'azle';

export const Allowances = Record({
    spender: text, // 내가 사용하도록 승인해준 사람의 주소
    amount: nat64, // 내가 사용하도록 승인해준 토큰의 양
});

export const Account = Record({
    address: text, // 사용자의 id
    balance: nat64, // 사용자가 가진 토큰의 잔액
    allowances: Vec(Allowances), // 내가 승인해준 토큰(Allowances 타입의 배열)
});

// text : address(키), 값:객체, 아이디:0
let state = StableBTreeMap(text, Account, 0);
const admins: Vec<string> = []; // 토큰을 민팅하거나 버닝할 수 있는 어드민의 주소

// 토큰의 기본적인 정보
const tokenInfo = {
    name: '',
    ticker: '',
    totalSupply: 0n,
    owner: '',
};

function isAdmin(address: string): boolean {
    if (admins.indexOf(address) == -1) {
        return false;
    }
    return true;
}

// 자주 쓰임, 이 함수를 호출한 사람의 아이덴티티 주소를 반환함
function getCaller(): string {
    const caller = ic.caller().toString();
    if (caller === null) {
        throw new Error('Caller is null');
    }
    return caller;
}

function getAccountByAddress(address: text): Opt<typeof Account> {
    return state.get(address);
}

// state.insert : 스테이블 메모리에 저장
function insertAccount(address: text, account: typeof Account): typeof Account {
    state.insert(address, account);
    const newAccountOpt = getAccountByAddress(address); // 어카운트 반환
    if ('None' in newAccountOpt) {
        throw new Error('Insert failed');
    }
    return newAccountOpt.Some;
}

function _allowance(owner: string, spender: string): nat64 {
    /*
     * TO-DO: 토큰을 얼마나 approve 했는지 확인합니다.
     * approve하지 않았다면 0n을 반환합니다.
     */

    // 1. ownerAccount를 가져온다.
    const ownerAccountOpt = getAccountByAddress(owner);
    if ('None' in ownerAccountOpt) throw new Error('owner account not found');
    const ownerAccount = ownerAccountOpt.Some;

    // 2. allowance가 있는지 확인한다.
    for (let allowance of ownerAccount.allowances) {
        if (allowance.spender == spender) return allowance.amount;
    }

    return 0n;
}

function _transferFrom(from: text, to: text, amount: nat64): bool {
    /*
     * TO-DO: approve 받은 토큰을 전송 합니다.
     * 전송 후 allowance를 갱신하는 것을 잊지 마세요!
     */

    // 1. spender(caller)의 계정 확인
    const spender = getCaller();
    const spenderAccountOpt = getAccountByAddress(spender);
    if ('None' in spenderAccountOpt) throw new Error('스팬더 계정 없음');
    const spenderAccount = spenderAccountOpt.Some;

    // 2. from의 계정을 가져오기
    const fromAccountOpt = getAccountByAddress(from);
    if ('None' in fromAccountOpt) throw new Error('from account 계정 없음');
    const fromAccount = fromAccountOpt.Some;

    // 3. to의 계정을 가져오기
    // 받는사람 계정 없으면 새로 만들어줌
    let toAccount;
    const toAccountOpt = getAccountByAddress(to);
    if ('None' in toAccountOpt) {
        const newToAccount = {
            address: to,
            balance: 0n,
            allowances: [],
        };
        toAccount = insertAccount(to, newToAccount);
    } else {
        toAccount = toAccountOpt.Some;
    }

    // 4. allowance 가 부족하면 transferfrom 수행 ㄴㄴ
    const allowance = _allowance(from, spender);
    if (allowance === undefined || allowance < amount) return false;

    // 5. 부족하지 않으면 fromaccount-spender간의 allowance 갱신해줌
    for (let i = 0; i < fromAccount.allowances.length; i++) {
        if (fromAccount.allowances[i].spender === spender) {
            fromAccount.allowances[i] = {
                spender,
                amount: fromAccount.allowances[i].amount - amount,
            };
        }
    }

    // 6. 실제로 transfer진행
    fromAccount.balance -= amount;
    toAccount.balance += amount;

    insertAccount(from, fromAccount);
    insertAccount(to, toAccount);

    return true;
}

export default Canister({
    allState: query([], Vec(Account), () => {
        return state.values();
    }),

    getAdmins: query([], Vec(text), () => {
        return admins;
    }),

    addAdmin: update([text], bool, (address) => {
        /*
         * TO-DO: admin을 추가합니다.
         * admin을 추가하거나 삭제하는 작업은 admin 권한을 가진 사용자만 실행할 수 있어야 합니다.
         */
        const caller = getCaller();
        if (!isAdmin(caller)) return false;

        admins.push(address);
        return true;
    }),

    deleteAdmin: update([text], bool, (address) => {
        /*
         * TO-DO: admin을 삭제합니다.
         * admin을 추가하거나 삭제하는 작업은 admin 권한을 가진 사용자만 실행할 수 있어야 합니다.
         */

        const caller = getCaller();

        // 관리자만 삭제할수있음
        if (!isAdmin(caller)) return false;

        // 인덱스 찾음
        const indexToDelete = admins.indexOf(address);

        // 관리자에서 잘라냄
        if (indexToDelete !== -1) admins.splice(indexToDelete, 1);

        return true;
    }),

    // 토큰 캐니스터를 배포하고 나면 맨처음 이걸 호출해야함(토큰캐니스터 구성하기)
    // 인자 : 토큰이름, 토큰단위, 총발행개수
    initialize: update([text, text, nat64], text, (name, ticker, totalSupply) => {
        const ownerAddress = getCaller(); // 내부 함수 실행

        // 계정 생성
        const creatorAccount: typeof Account = {
            address: ownerAddress,
            balance: totalSupply,
            allowances: [],
        };

        // 토큰 정보
        tokenInfo.name = name;
        tokenInfo.ticker = ticker;
        tokenInfo.totalSupply = totalSupply;
        tokenInfo.owner = ownerAddress;

        // state에 새로운 어카운트를 스테이블 메모리에 넣어줌.(address, account)
        insertAccount(ownerAddress, creatorAccount);

        // 관리자 목록에 주소를 추가함
        admins.push(ownerAddress);

        return ownerAddress;
    }),

    name: query([], text, () => {
        return tokenInfo.name;
    }),

    ticker: query([], text, () => {
        return tokenInfo.ticker;
    }),

    totalSupply: query([], nat64, () => {
        return tokenInfo.totalSupply;
    }),

    owner: query([], text, () => {
        return tokenInfo.owner;
    }),

    // 계정의 잔액
    balanceOf: query([text], nat64, (address) => {
        /*
         * TO-DO: 계정의 반액을 반환한다.
         * getAccountByAddress() 를 사용하세요.
         * 위 함수 : 저장된어카운트목록에서 주소를통해 어카운트 객체 가져옴
         * state에 사용자 정보가 없는 경우, 0을 반환합니다.
         */
        // 1. address에 해당하는 account를 가져옴
        // 2. 없다면 0을 반환하고 있다면 해당 balance를 반환함

        // Opt : 어카운트 반환할건데, 있을수있고 없을수있다는뜻
        const accountOpt = getAccountByAddress(address);

        // 없으면 0 반환
        if ('None' in accountOpt) return 0n;
        return accountOpt.Some.balance;
    }),

    transfer: update([text, nat64], bool, (to, amount) => {
        /*
         * TO-DO: 토큰을 전송합니다.
         * getAccountByAddress() 함수를 사용하세요.
         */

        // 1. 보내는 사람(caller)의 account 가져오기
        const fromAddress = getCaller(); // 중요
        // 정상적인 주소인지 확인(주소에 해당하는 어카운트가 있음)
        const fromAccountOpt = getAccountByAddress(fromAddress);
        if ('None' in fromAccountOpt) throw new Error('fromAccount not found');
        const fromAccount = fromAccountOpt.Some;

        // 2. 받는 사람의 account를 가져오기
        // 계정이 없다면 새로 만들어 줘야 함
        let toAccountOpt = getAccountByAddress(to);
        let toAccount;
        if ('None' in toAccountOpt) {
            // 새로운 계정 만들어줌
            const newToAccount: typeof Account = {
                address: to,
                balance: 0n,
                allowances: [],
            };

            // 계정을 스테이블 메모리에 넣어줌
            toAccount = insertAccount(to, newToAccount); // 주소, 계좌
        } else {
            // 계좌가 이미 있다면
            toAccount = toAccountOpt.Some;
        }

        // 3. 보내는 사람이 충분한 양의 잔액을 가지고 있는지 확인
        // amount : 보내고 싶어하는 값
        if (!fromAccount || fromAccount.balance < amount) return false;

        // 4. 실제 토큰을 전송한다.
        fromAccount.balance -= amount;
        toAccount.balance += amount;

        // 5. 가져온 어카운트의 속성을 변경했기 때문에
        // 다시 insertAccount를 통해서 값을 반영해 주는 것이다.
        insertAccount(fromAddress, fromAccount);
        insertAccount(to, toAccount);

        return true;
    }),

    approve: update([text, nat64], bool, (spender, amount) => {
        /*
         * TO-DO: 토큰을 approve 합니다.
         * 기존에 owner가 spender에게 토큰을 approve한 경우, 기존의 값을 덮어 씌워야 합니다.
         * 이전에 이미 조금 승인한 상태라면 기존값을 덮어쓴다. 처음이라면 그냥 추가.
         */

        // 1. owner의 account가져오기(caller)
        const ownerAddress = getCaller();
        const ownerAccountOpt = getAccountByAddress(ownerAddress);
        // 만약 어카운트 가져오는데 실패하면 에러
        if ('None' in ownerAccountOpt) throw new Error('Owner Account not found.');
        const ownerAccount = ownerAccountOpt.Some;

        // 2. spender(승인받을사람)의 account를 가져온다.
        const spenderAccountOpt = getAccountByAddress(spender);
        let spenderAccount;
        if ('None' in spenderAccountOpt) {
            // 2-1. spender의 계정이 없으면 만들어줌
            const newSpenderAccount: typeof Account = {
                address: spender,
                balance: 0n,
                allowances: [],
            };
            // 스테이블 메모리에 저장해줌
            spenderAccount = insertAccount(spender, newSpenderAccount);
        } else {
            spenderAccount = spenderAccountOpt.Some;
        }

        // 3. owner가 충분한 양의 토큰을 가지고 있는지 확인
        if (!ownerAccount || ownerAccount.balance < amount) return false;

        // 4. approve(승인) 진행
        // 기존에 owner가 spender에게 토큰을 approve한 경우
        // 기존의 값을 덮어 씌워야 한다.
        // 주인의 허용목록에서 확인함
        let exist = false;
        for (let i = 0; i < ownerAccount.allowances.length; i++) {
            const key = ownerAccount.allowances[i].spender;
            if (key == spender) {
                exist = true;
                ownerAccount.allowances[i] = { spender, amount }; // 값 갱신
                break; // 빠져나감 ㅎㅎ
            }
        }

        // 처음 approve인 경우 그냥 추가
        if (!exist) ownerAccount.allowances.push({ spender, amount });

        // 변경사항 저장
        insertAccount(ownerAddress, ownerAccount);

        return true; // 정상임을 반환
    }),

    // 간단함. allowance : 데이터를 가져옴
    allowance: query([text, text], nat64, (owner, spender) => {
        return _allowance(owner, spender);
    }),

    // owner -> 호출자 에 대한 allowance
    allowanceFrom: query([text], nat64, (owner) => {
        /*
         * TO-DO: 인자로 주어진 owner가 함수를 호출한 caller에게 토큰을 얼마나 approve 해주었는지 확인합니다.
         * allowanceFrom() 함수는 주로 캐니스터 컨트랙트에서 "사용자가 캐니스터에 얼마나 approve 했는지"(사용자 -> 캐니스터) 확인할 때 사용합니다.
         */

        // 1. 함수 호출자(caller)가 계정이 있는지 확인
        const spender = getCaller();
        const spenderAccountOpt = getAccountByAddress(spender);
        if ('None' in spenderAccountOpt) return 0n;
        else return _allowance(owner, spender);

        return 0n;
    }),

    // 함수호출자가 amount만큼 to에게 전송한다.
    transferFrom: update([text, text, nat64], bool, (from, to, amount) => {
        return _transferFrom(from, to, amount);
    }),

    // 새로운 토큰을 발행해버림
    mint: update([text, nat64], bool, (to, amount) => {
        /*
         * TO-DO: 새로운 토큰을 to에게 발행합니다.
         * mint 함수는 admin 권한이 있는 계정만 호출할 수 있습니다.
         */
        const caller = getCaller();

        // mint 함수는 admin인 계정만 호출할 수 있습니다.
        if (admins.indexOf(caller) == -1) {
            throw new Error('Only admins can mint new tokens');
        }

        const callerAccountOpt = getAccountByAddress(caller);

        if ('None' in callerAccountOpt) {
            throw new Error('Caller account not found');
        }
        const callerAccount = callerAccountOpt.Some;

        const toAccountOpt = getAccountByAddress(to);
        if ('None' in toAccountOpt) {
            throw new Error('Recipient account not found');
        }
        const toAccount = toAccountOpt.Some;

        toAccount.balance += amount;
        tokenInfo.totalSupply += amount; // 전체발행량에도 추가

        insertAccount(to, toAccount);
        return true;
    }),

    // 토큰을 소각(어드민만)
    burn: update([text, nat64], bool, (from, amount) => {
        /*
         * TO-DO: from이 소유한 일정량의 토큰을 소각합니다.
         * burn 함수는 admin 권한이 있는 계정만 호출할 수 있습니다.
         */
        const caller = getCaller();

        // burn 함수는 admin인 계정만 호출할 수 있습니다.
        if (admins.indexOf(caller) == -1) {
            throw new Error('Only admins can burn tokens');
        }

        const callerAccountOpt = getAccountByAddress(caller);

        if ('None' in callerAccountOpt) {
            throw new Error('Caller account not found');
        }
        const callerAccount = callerAccountOpt.Some;

        if (_allowance(from, caller) < amount) {
            throw new Error('Insufficient allowance to burn');
        }

        if (tokenInfo.totalSupply < amount) {
            throw new Error('Insufficient tokens to burn');
        }
        _transferFrom(from, '0', amount); // from이 가진 토큰중 amount만큼을 "0"주소로 보낸다.(못쓰는곳)
        tokenInfo.totalSupply -= amount; // 총 발행량 감소

        insertAccount(caller, callerAccount);
        return true;
    }),
});
