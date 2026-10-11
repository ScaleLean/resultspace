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
            admin('agent','add',company,'hermes','member')
            admin('agent','key',company,'hermes','--out',str(cls.path / (company+'.key')))
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
