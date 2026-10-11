"""Real server read/record and isolation, disposable data and profiles only."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'integrations/hermes-plugin'))
from resultspace import rsclient, register

class Knowledge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='rs-plugin-')
        cls.path = Path(cls.tmp.name)
        cls.env = {**os.environ, 'DATA_DIR': str(cls.path / 'data'), 'RS_CURATOR_AUTO': 'off'}
        cls.env.pop('FIREWORKS_API_KEY', None)
        def admin(*args):
            subprocess.run(['node', 'src/admin.ts', *args], cwd=ROOT, env=cls.env, check=True, capture_output=True)
        for company in ['acme','other']:
            admin('company','create',company,company)
            admin('agent','add',company,'hermes' if company == 'acme' else 'other-hermes','member')
            admin('agent','key',company,'hermes' if company == 'acme' else 'other-hermes','--out',str(cls.path / (company+'.key')))
        admin('agent','add','acme','key-reviewer','admin')
        admin('agent','key','acme','key-reviewer','--out',str(cls.path/'admin.key'))
        admin('agent','add','acme','revocation-test','member')
        admin('agent','key','acme','revocation-test','--out',str(cls.path/'revoked.key'))
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        cls.env.update(PORT=str(port),HOST='127.0.0.1')
        cls.proc=subprocess.Popen(['node','src/server.ts'],cwd=ROOT,env=cls.env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        cls.c=rsclient.Client('http://127.0.0.1:'+str(port),{c:cls.path/(c+'.key') for c in ['acme','other']},'acme')
        for _ in range(100):
            try: cls.c.me(); break
            except rsclient.RsError: time.sleep(.05)
        else: cls.proc.terminate(); raise RuntimeError('Disposable server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.communicate(timeout=10); cls.tmp.cleanup()

    def test_read_record_and_company_wall(self):
        c=self.c
        project=c.create_record('project',{'title':'Supplier research','goal':'Understand lead time','objectives':['Compare sources'],'current_state':'Researching'})
        fact=c.create_record('fact',{'title':'Lead time','subject':'Supplier','predicate':'lead_time','value_type':'number','value':4,'unit':'weeks','source':'Supplier quote, Oct 11','project_id':project['id']})
        context=c.project_context(project['key'])
        self.assertEqual(context['facts'][0]['record']['id'],fact['id'])
        self.assertEqual(context['facts'][0]['provenance']['actor'],'hermes')
        learned=c.record_learning(project['key'],'Lead time confirmed','Quote specifies four weeks','Supplier quote, Oct 11',idempotency_key='plugin-learning-001')
        self.assertEqual(c.record_learning(project['key'],'Lead time confirmed','Quote specifies four weeks','Supplier quote, Oct 11',idempotency_key='plugin-learning-001')['id'],learned['id'])
        self.assertEqual(c.project_context(project['key'])['log'][0]['record']['body']['source'],'Supplier quote, Oct 11')
        with self.assertRaises(rsclient.RsError): c.project_context(project['id'],'other')
        self.assertEqual(c.search('Supplier',company='other'),[])
        with self.assertRaises(rsclient.RsError): c.record_learning(project['key'],'Unsupported','Text','')
        with self.assertRaises(rsclient.RsError): c.op('assignment.next',{})

    def test_plugin_has_explicit_knowledge_tools_and_no_hooks(self):
        class Context:
            def __init__(self): self.tools=[]; self.sections=[]
            def register_tool(self,name,*args,**kw): self.tools.append(name)
            def register_system_prompt_section(self,*args,**kw): self.sections.append(args[0])
        ctx=Context(); register(ctx)
        self.assertEqual(ctx.tools,['rs_context','rs_learn'])
        self.assertEqual(ctx.sections,['resultspace.brief'])
        self.assertFalse(hasattr(rsclient.Client,'presence'))
        self.assertFalse(hasattr(rsclient.Client,'assignment_next'))

    def test_key_permissions_and_profile_config(self):
        key=self.path/'insecure.key';key.write_text('never-printed');key.chmod(0o644)
        c=rsclient.Client(self.c.server_url,{'acme':key},'acme')
        with self.assertRaisesRegex(rsclient.RsError,'chmod 600'): c.me()
        cfg=self.path/'cli.toml';cfg.write_text('server_url = "'+self.c.server_url+'"\ndefault_company = "acme"\n[companies.acme]\nkey_file = "'+str(self.path/'acme.key')+'"\n')
        configured=rsclient.Client.for_profile('disposable',env={'RS_CONFIG':str(cfg)})
        self.assertEqual(configured.me()['company']['slug'],'acme')


    def test_missing_wrong_revoked_keys_and_unreachable_server(self):
        cases = [({}, "no key_file configured"), ({'acme': self.path/'absent.key'}, "cannot read key file")]
        empty = self.path/'empty.key'; empty.write_text(''); empty.chmod(0o600)
        cases.append(({'acme': empty}, "empty"))
        for keys, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(rsclient.RsError, message) as failure:
                    rsclient.Client(self.c.server_url, keys, 'acme').me()
                self.assertEqual(failure.exception.status, 0)
        wrong = self.path/'wrong.key'; wrong.write_text('invalid-disposable-key'); wrong.chmod(0o600)
        with self.assertRaises(rsclient.RsError) as failure:
            rsclient.Client(self.c.server_url, {'acme': wrong}, 'acme').me()
        self.assertEqual(failure.exception.status, 401)
        victim = rsclient.Client(self.c.server_url, {'acme': self.path/'revoked.key'}, 'acme')
        self.assertEqual(victim.me()['actor']['name'], 'revocation-test')
        admin = rsclient.Client(self.c.server_url, {'acme': self.path/'admin.key'}, 'acme')
        admin.op('agent.revoke', {'name': 'revocation-test'})
        with self.assertRaises(rsclient.RsError) as failure: victim.me(refresh=True)
        self.assertEqual(failure.exception.status, 401)
        with self.assertRaises(rsclient.RsError) as failure: victim.project_context('PRJ-0001')
        self.assertEqual(failure.exception.status, 401)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            unreachable = rsclient.Client('http://127.0.0.1:'+str(sock.getsockname()[1]), self.c.key_files, 'acme', timeout=.2)
            with self.assertRaisesRegex(rsclient.RsError, 'unreachable') as failure: unreachable.me()
            self.assertEqual(failure.exception.status, 0)

    def test_profile_failures_and_exact_authenticated_identity(self):
        cfg = self.path/'invalid-profile.toml'
        with self.assertRaisesRegex(rsclient.RsError, 'missing'):
            rsclient.Client.for_profile('missing', env={'RS_CONFIG':str(cfg)})
        for text, message in [
            ('broken = [', 'unreadable'),
            ('[companies.acme]\nkey_file="anything"', 'server_url'),
            ('server_url=42', 'server_url'),
            ('server_url="http://["', 'HTTP'),
            ('server_url="http://localhost"', 'key_file entries'),
            ('server_url="http://localhost"\n[companies.acme]\nkey_file=42', 'nonempty path'),
            ('server_url="http://localhost"\ndefault_company="wrong"\n[companies.acme]\nkey_file="anything"', 'default_company'),
        ]:
            cfg.write_text(text)
            with self.subTest(text=text):
                with self.assertRaisesRegex(rsclient.RsError, message):
                    rsclient.Client.for_profile('broken', env={'RS_CONFIG':str(cfg)})
        base = self.path/'config'/'resultspace'
        base.mkdir(parents=True)
        def config(company):
            return f'server_url = "{self.c.server_url}"\ndefault_company = "{company}"\n[companies.{company}]\nkey_file = "{self.path/(company+".key")}"\n'
        (base/'cli.toml').write_text(config('acme'))
        named = base/'profiles'/'supplier-research'; named.mkdir(parents=True)
        (named/'cli.toml').write_text(config('other'))
        env = {'XDG_CONFIG_HOME':str(self.path/'config')}
        for profile, company, identity in [('default','acme','hermes'), ('supplier-research','other','other-hermes')]:
            c = rsclient.Client.for_profile(profile, env=env)
            me = c.me()
            self.assertEqual(me['company'], {'slug':company, 'name':company})
            self.assertEqual(me['actor'], {'kind':'agent', 'name':identity, 'role':'member'})
            learned = c.create_record('knowledge', {'title':'Identity check', 'source':'Disposable citation'})
            self.assertEqual(learned['updated_by'], identity)
            self.assertEqual(c.brief()['actor'], me['actor'])

    def test_missing_named_profile_never_falls_back_to_default_identity(self):
        base = self.path/'fail-closed-config'/'resultspace'
        base.mkdir(parents=True)
        def config(company):
            return f'server_url = "{self.c.server_url}"\ndefault_company = "{company}"\n[companies.{company}]\nkey_file = "{self.path/(company+".key")}"\n'
        default = base/'cli.toml'
        default.write_text(config('acme'))
        env = {'XDG_CONFIG_HOME': str(base.parent)}
        expected = base/'profiles'/'missing-named'/'cli.toml'
        self.assertEqual(rsclient.config_path('missing-named', env), expected)
        with self.assertRaisesRegex(rsclient.RsError, "no ResultSpace config for profile 'missing-named'"):
            rsclient.Client.for_profile('missing-named', env=env)
        # Default deliberately uses base, even if profiles/default contains another identity.
        default_profile = base/'profiles'/'default'
        default_profile.mkdir(parents=True)
        (default_profile/'cli.toml').write_text(config('other'))
        me = rsclient.Client.for_profile('default', env=env).me()
        self.assertEqual(me['company']['slug'], 'acme')
        self.assertEqual(me['actor'], {'kind':'agent', 'name':'hermes', 'role':'member'})
        explicit = self.path/'explicit-profile-override.toml'
        explicit.write_text(config('other'))
        client = rsclient.Client.for_profile('missing-named', env={**env, 'RS_CONFIG': str(explicit)})
        me = client.me()
        self.assertEqual(me['company']['slug'], 'other')
        self.assertEqual(me['actor'], {'kind':'agent', 'name':'other-hermes', 'role':'member'})
        recorded = client.create_record('knowledge', {'title':'Explicit identity', 'source':'Disposable citation'})
        history = client.op('record.history', {'ref':recorded['key']})
        self.assertEqual(recorded['updated_by'], 'other-hermes')
        self.assertEqual(history[0]['actor'], me['actor']['name'])
